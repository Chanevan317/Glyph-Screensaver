#!/usr/bin/env bash
# Glyph Screensaver installer: the animation engine (Python venv) + the GNOME Shell extension.
#
#   curl -fsSL https://raw.githubusercontent.com/Chanevan317/Glyph-Screensaver/main/install.sh | bash
#
# Run from a clone, it builds and installs that checkout instead of the latest release.
set -euo pipefail

UUID=glyph-screensaver@Chanevan317
REPO=Chanevan317/Glyph-Screensaver
ZIP_URL="https://github.com/$REPO/releases/latest/download/$UUID.shell-extension.zip"
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/glyph-screensaver/venv"

# Set when run as a file from a clone; empty when piped from curl.
SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/metadata.json" ]]; then
    SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# ---- prerequisites ----
command -v gnome-extensions >/dev/null || die "gnome-extensions not found. Glyph Screensaver needs GNOME Shell 45 or newer."
command -v python3 >/dev/null || die "python3 is required. Install it with your package manager."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' || die "Python 3.8 or newer is required."
python3 -c 'import venv, ensurepip' 2>/dev/null ||
    die "Python's venv module is missing. On Debian/Ubuntu run: sudo apt install python3-venv"

# ---- animation engine ----
say "Installing the animation engine (terminaltexteffects + pyfiglet)"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --disable-pip-version-check --upgrade pip
"$VENV/bin/pip" install --quiet --disable-pip-version-check "terminaltexteffects>=0.15,<0.16" pyfiglet

# ---- extension ----
# Check the disk, not `gnome-extensions info`: the running shell only knows extensions loaded at login.
installed() {
    local d dirs
    IFS=: read -ra dirs <<< "${XDG_DATA_HOME:-$HOME/.local/share}:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
    for d in "${dirs[@]}"; do
        [[ -f "$d/gnome-shell/extensions/$UUID/metadata.json" ]] && return 0
    done
    return 1
}

if [[ -n "$SRC" ]]; then
    say "Installing the extension from $SRC"
    "$SRC/pack.sh" >/dev/null
    gnome-extensions install --force "$SRC/dist/$UUID.shell-extension.zip"
elif installed; then
    say "Extension already installed; leaving it as is (updates come through Extension Manager)"
else
    say "Downloading the latest release"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    if command -v curl >/dev/null; then
        curl -fsSL -o "$TMP/ext.zip" "$ZIP_URL"
    elif command -v wget >/dev/null; then
        wget -qO "$TMP/ext.zip" "$ZIP_URL"
    else
        die "curl or wget is needed to download the extension."
    fi
    gnome-extensions install --force "$TMP/ext.zip"
fi

# ---- enable ----
# A freshly installed extension is only loaded by GNOME Shell after the next login, so if enabling
# now fails, add it to the enabled list directly and it starts with the next session.
if gnome-extensions enable "$UUID" 2>/dev/null; then
    say "Done! Glyph Screensaver is installed and enabled."
else
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    updated="$(python3 -c '
import ast, sys
cur, uuid = sys.argv[1], sys.argv[2]
cur = cur.strip()
lst = ast.literal_eval(cur[3:] if cur.startswith("@as") else cur)
if uuid not in lst:
    lst.append(uuid)
print(str(lst))
' "$current" "$UUID")"
    gsettings set org.gnome.shell enabled-extensions "$updated"
    say "Done! Log out and back in to start Glyph Screensaver."
fi

if [[ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" == "true" ]]; then
    echo "Note: user extensions are switched off globally. Turn them on in Extension Manager or the Extensions app."
fi
echo "Change the text, font and effects in the extension's settings."
