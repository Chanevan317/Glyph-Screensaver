#!/bin/bash
# Glyph Screensaver compatibility tests: runs the extension in a real, headless GNOME Shell for each
# supported version, in parallel podman containers.
#
#   tests/run.sh              all versions
#   tests/run.sh 46 51        only these
#   tests/run.sh --rebuild 51 rebuild the container image first
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"

# GNOME version -> container recipe and base image. Add a line here for each new GNOME release.
declare -A IMAGES=(
    [45]="Containerfile.fedora VER=39"
    [46]="Containerfile.deb BASE=docker.io/library/ubuntu:24.04"
    [47]="Containerfile.fedora VER=41"
    [48]="Containerfile.deb BASE=docker.io/library/debian:trixie"
    [49]="Containerfile.fedora VER=43"
    [50]="Containerfile.fedora VER=44"
    [51]="Containerfile.fedora VER=45"
)

REBUILD=0
[[ "${1:-}" == "--rebuild" ]] && { REBUILD=1; shift; }
VERSIONS=("$@")
[[ ${#VERSIONS[@]} -eq 0 ]] && mapfile -t VERSIONS < <(printf '%s\n' "${!IMAGES[@]}" | sort -n)
command -v podman >/dev/null || { echo "podman is required" >&2; exit 1; }
for v in "${VERSIONS[@]}"; do
    [[ -n "${IMAGES[$v]:-}" ]] || { echo "Unknown GNOME version: $v (known: ${!IMAGES[*]})" >&2; exit 1; }
done

# Python wheels for the engine, downloaded once so containers don't hit PyPI in parallel.
if ! ls "$HERE"/wheels/terminaltexteffects-*.whl >/dev/null 2>&1; then
    echo "==> Downloading Python wheels"
    tmp="$(mktemp -d)"
    python3 -m venv "$tmp" && "$tmp/bin/pip" download -q --disable-pip-version-check -d "$HERE/wheels" \
        pip "terminaltexteffects>=0.15,<0.16" pyfiglet || { rm -rf "$tmp"; echo "wheel download failed" >&2; exit 1; }
    rm -rf "$tmp"
fi

# Container images (built once, reused).
build() {
    local v=$1 recipe=${IMAGES[$1]% *} arg=${IMAGES[$1]#* }
    if [[ $REBUILD -eq 1 ]] || ! podman image exists "glyph-gnome$v"; then
        mkdir -p "$HERE/out"
        podman build -q -t "glyph-gnome$v" -f "$HERE/$recipe" --build-arg "$arg" "$HERE" > "$HERE/out/build-$v.log" 2>&1 ||
            { echo "FAILED to build GNOME $v image (see tests/out/build-$v.log)" >&2; return 1; }
    fi
}
echo "==> Preparing images: ${VERSIONS[*]}"
for v in "${VERSIONS[@]}"; do build "$v" & done
wait

echo "==> Testing (about 3-5 minutes)"
for v in "${VERSIONS[@]}"; do
    (
        out="$HERE/out/$v"; rm -rf "$out"; mkdir -p "$out"
        podman image exists "glyph-gnome$v" || { echo "FAIL image missing" > "$out/results.txt"; exit; }
        podman run --rm --name "glyph-test-$v" \
            -v "$REPO:/src:ro,z" -v "$HERE:/harness:ro,z" -v "$out:/out:z" \
            "glyph-gnome$v" dbus-run-session -- bash /harness/inside.sh > "$out/session.log" 2>&1
    ) &
done
wait

# Summary.
status=0
echo
for v in "${VERSIONS[@]}"; do
    r="$HERE/out/$v/results.txt"
    shell=$(grep -o 'gnome-shell [0-9.]*' "$r" 2>/dev/null | head -1 | cut -d' ' -f2)
    pass=$(grep -c '^PASS' "$r" 2>/dev/null); fail=$(grep -c '^FAIL' "$r" 2>/dev/null)
    if [[ "$fail" -eq 0 && "$pass" -gt 0 ]]; then mark="ok  "; else mark="FAIL"; status=1; fi
    printf '%s GNOME %-3s (%-6s) %3s passed, %s failed\n' "$mark" "$v" "${shell:-?}" "$pass" "$fail"
    grep '^FAIL' "$r" 2>/dev/null | sed 's/^/       /'
done
echo
echo "Logs and screenshots: tests/out/<version>/"
exit $status
