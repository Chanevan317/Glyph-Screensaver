# Glyph Screensaver

**I loved my time on Omarchy, but I missed GNOME.** So I went back to Fedora 45 with GNOME 51, and soon found myself missing Omarchy's gorgeous screensaver. With Claude by my side, I decided to bring it to GNOME. I hope you enjoy it!

An animated ASCII-art screensaver for GNOME. Your text in big figlet letters on a pure black screen, brought to life by [terminaltexteffects](https://github.com/ChrisBuilds/terminaltexteffects). Inspired by the [Omarchy](https://omarchy.org) screensaver.

![Glyph Screensaver preview](assets/preview.gif)

## Features

- **Native GNOME Shell overlay.** Drawn by the shell itself (no terminal window), pure black, cursor hidden, on top of everything.
- **37 animations** from terminaltexteffects. A random one plays each cycle, with Omarchy's exact settings. Turn effects on or off and preview each one from the settings.
- **14 font styles**, with Omarchy's Delta Corps Priest as the default. A live preview shows your text as you type.
- **Behaves well.** Starts after your chosen idle time, or right away with **Super+Alt+G**. Stays away during video, calls and fullscreen apps. Any key, click or mouse movement dismisses it.

![Font styles](assets/styles.png)

## Install

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/Chanevan317/Glyph-Screensaver/main/install.sh | bash
```

Then log out and back in. Run the same command again any time to update.

You need GNOME Shell 45 or newer and Python 3.8+. On Debian/Ubuntu, run `sudo apt install python3-venv` first.

> **Not on extensions.gnome.org.** Glyph Screensaver isn't listed on the GNOME Extensions website, so you won't find it by searching in Extension Manager. Install it with the command above. Once installed, it appears in Extension Manager and the Extensions app like any other extension, where you can turn it on or off, open its settings, or remove it.

<details>
<summary>What the command does</summary>

It puts the animation engine (`terminaltexteffects` + `pyfiglet`) in a private virtualenv at `~/.local/share/glyph-screensaver/venv`, installs the latest release of the extension (upgrading an existing install), and enables it. Run it again any time to update. Nothing is installed system-wide and no `sudo` is used. Running `./install.sh` from a clone installs that checkout instead.

</details>

## Settings

Open **Extensions → Glyph Screensaver → Settings** to change the text (leave it empty to use your user name), the font style and size, the idle delay and the start shortcut, to pick effects, or to press **Preview**.

## Starting it

- **Automatically** after the idle time you choose (2.5 minutes by default).
- **Right away** with **Super+Alt+G**, from the desktop or the overview. Change or disable the shortcut under **Settings → Behavior → Start shortcut**.
- **From the settings** with the **Preview** button.

Any key, click or mouse movement dismisses it. It doesn't start while a video, call or fullscreen app is active, and the shortcut does nothing on the lock screen.

## Power and screen blanking

The screensaver only draws on top of your desktop. It doesn't change any power settings, and everything underneath keeps running.

- **Screen Blank** (Settings → Power) still applies. With GNOME's default of 5 minutes, you'll see the screensaver from 2.5 minutes until the screen blanks; it then closes and stops its animation engine. Set Screen Blank to **Never** to keep it running.
- **Automatic Suspend** works as usual, plugged in or on battery. The screensaver never blocks it.
- **Screen lock** takes over when it triggers, and the screensaver closes.
- **It works the same on the charger and on battery.** While it runs, the animation engine uses roughly a quarter of one CPU core (up to about two thirds for the Matrix effect), so on battery it drains faster than a blank screen.

## How it works

`helper/tte_stream.py` drives terminaltexteffects' engine with the same options Omarchy's screensaver uses and streams each frame's characters to the extension. `renderer.js` paints them on the overlay the way a terminal would, drawing block and box characters itself so the letters are seamless.

## Compatibility

Works on GNOME 45–51. Every version is tested end to end in a real GNOME Shell (see [tests](tests/README.md)): run `tests/run.sh` with podman installed. Reports from real-world setups are welcome.

## Credits

- [terminaltexteffects](https://github.com/ChrisBuilds/terminaltexteffects) by ChrisBuilds: the animation engine
- [pyfiglet](https://github.com/pwaller/pyfiglet) and the FIGlet font authors: the letter styles
- [Omarchy](https://github.com/basecamp/omarchy): the inspiration and its screensaver settings

Not affiliated with Omarchy or the GNOME Project.

## License

[MIT](LICENSE)
