#!/usr/bin/env bash
# Install Glyph Screensaver: the animation engine (Python venv) + the GNOME Shell extension.
set -euo pipefail
UUID=glyph-screensaver@Chanevan317
DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/glyph-screensaver/venv"

die() { echo "Error: $*" >&2; exit 1; }

command -v gnome-extensions >/dev/null || die "gnome-extensions not found. Is GNOME Shell 45 or newer installed?"
command -v python3 >/dev/null || die "python3 is required. Install it with your package manager."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' || die "Python 3.8 or newer is required."
python3 -c 'import venv, ensurepip' 2>/dev/null ||
    die "Python's venv module is missing. On Debian/Ubuntu: sudo apt install python3-venv"

echo "==> Installing terminaltexteffects + pyfiglet into $VENV"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "terminaltexteffects>=0.15,<0.16" pyfiglet

echo "==> Installing the extension"
"$DIR/pack.sh"
gnome-extensions install --force "$DIR/dist/$UUID.shell-extension.zip"

echo
echo "Done! Log out and back in (required on Wayland), then run:"
echo "  gnome-extensions enable $UUID"
