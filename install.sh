#!/usr/bin/env bash
# Install Glyph Screensaver: the animation engine (Python venv) + the GNOME Shell extension.
set -euo pipefail
UUID=glyph-screensaver@Chanevan317
DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="${XDG_DATA_HOME:-$HOME/.local/share}/glyph-screensaver/venv"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

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
