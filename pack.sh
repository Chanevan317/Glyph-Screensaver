#!/usr/bin/env bash
# Build the extension zip (for extensions.gnome.org or `gnome-extensions install`) into dist/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
gnome-extensions pack --force --out-dir dist \
  --extra-source=common.js --extra-source=renderer.js --extra-source=helper \
  --schema=schemas/org.gnome.shell.extensions.glyph-screensaver.gschema.xml .
echo "Built dist/glyph-screensaver@Chanevan317.shell-extension.zip"
