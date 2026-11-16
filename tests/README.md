# Compatibility tests

Runs Glyph Screensaver in a real GNOME Shell for every supported version (45–51), each in its own
podman container, and checks that it actually works there.

```bash
tests/run.sh            # all versions, in parallel
tests/run.sh 46 51      # only these
tests/run.sh --rebuild 51   # rebuild that image first (e.g. to pick up distro updates)
```

You need `podman` and `python3`. The first run downloads the container images and builds them (a few
GB, several minutes). After that, a full run takes about 3–5 minutes. Results, logs and screenshots go
to `tests/out/<version>/`.

## What it checks

Each container installs the extension with `install.sh`, starts a headless GNOME Shell with a virtual
monitor, and loads a small test driver extension (`driver/`) that drives the real screensaver:

- it loads, opens, grabs input and paints real animation frames
- a key press, mouse movement and a mouse click each dismiss it
- the Preview button, the idle timer and the Super+Alt+G shortcut start it (the shortcut can be
  changed or disabled, and does nothing while disabled or on the lock screen)
- forced failures (during setup, after grabbing input, while painting, and painting nothing at all)
  never leave input grabbed
- a missing animation engine shows a message instead of a black screen
- it survives disable/enable and lock/unlock
- it closes and stops its engine when the displays switch off (screen blank)
- the preferences window opens

## Versions

| GNOME | Container |
|---|---|
| 45 | Fedora 39 |
| 46 | Ubuntu 24.04 |
| 47 | Fedora 41 |
| 48 | Debian 13 |
| 49 | Fedora 43 |
| 50 | Fedora 44 |
| 51 | Fedora 45 |

To test a new GNOME release, add a line to `IMAGES` in `run.sh` with a distro that ships it, run
`tests/run.sh <version>`, and add the version to `shell-version` in `metadata.json` once it passes.

## Notes

- Fedora releases past end-of-life are installed from the Fedora archive automatically.
- GNOME 49+ changed its screenshot API, so screenshots there come out empty; the checks don't rely
  on them.
- The containers have no systemd, so GNOME's screen shield doesn't exist there; screen blank is
  tested through the displays' power-save mode, which the extension also listens to.
