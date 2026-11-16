#!/bin/bash
# Runs inside a test container under dbus-run-session (started by run.sh).
# Mounts: /src = the repo (read-only), /harness = this tests/ folder, /out = results for this version.
export XDG_RUNTIME_DIR=/tmp/xdg; mkdir -p -m 700 "$XDG_RUNTIME_DIR"
RESULTS=/tmp/glyphtest/results.txt; mkdir -p /tmp/glyphtest

# Containers have no systemd: stop the shell from expecting logind, and give it a system bus.
rm -rf /run/systemd
mkdir -p /run/dbus && dbus-daemon --system --fork 2>/dev/null

# Install exactly like a user would, but with the pre-downloaded wheels instead of PyPI.
export PIP_NO_INDEX=1 PIP_FIND_LINKS=/harness/wheels
cp -r /src /work && cd /work && rm -rf dist tests/out tests/wheels
if ./install.sh > /out/install.log 2>&1; then echo "PASS install.sh" >> $RESULTS
else echo "FAIL install.sh (see install.log)" >> $RESULTS; fi

mkdir -p ~/.local/share/gnome-shell/extensions
cp -r /harness/driver/glyph-test@local ~/.local/share/gnome-shell/extensions/
gsettings set org.gnome.shell enabled-extensions "['glyph-screensaver@Chanevan317', 'glyph-test@local']"

help=$(gnome-shell --help 2>&1)
flags="--headless --virtual-monitor 1920x1080"
grep -q -- '--wayland ' <<<"$help" && flags+=" --wayland"
grep -q -- '--no-x11' <<<"$help" && flags+=" --no-x11"
gnome-shell $flags > /out/shell.log 2>&1 &
SHELL_PID=$!

for _ in $(seq 1 240); do
    grep -q '^DONE' $RESULTS 2>/dev/null && break
    if [[ -f /tmp/glyphtest/prefs-ready && -z "$PREFS" ]]; then
        PREFS=1
        # No gnome-session here, so tell D-Bus-activated apps (the prefs app) where the display is.
        gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
            --method org.freedesktop.DBus.UpdateActivationEnvironment \
            "{'WAYLAND_DISPLAY': 'wayland-0', 'XDG_RUNTIME_DIR': '$XDG_RUNTIME_DIR'}" >/dev/null
        WAYLAND_DISPLAY=wayland-0 gnome-extensions prefs glyph-screensaver@Chanevan317 >> /out/shell.log 2>&1
    fi
    kill -0 $SHELL_PID 2>/dev/null || { echo "FAIL gnome-shell exited early (see shell.log)" >> $RESULTS; break; }
    sleep 1
done
grep -q '^DONE' $RESULTS || echo "FAIL timed out" >> $RESULTS
kill $SHELL_PID 2>/dev/null; sleep 1
cp /tmp/glyphtest/* /out/ 2>/dev/null
