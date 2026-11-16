// Test driver for Glyph Screensaver. Runs inside a headless GNOME Shell next to the real extension,
// drives it, and writes PASS/FAIL lines to /tmp/glyphtest/results.txt (the harness collects them).
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'glyph-screensaver@Chanevan317';
const OUT = '/tmp/glyphtest';
const VENV = GLib.build_filenamev([GLib.get_user_data_dir(), 'glyph-screensaver', 'venv']);
const BLACK = 'background-color: #000000;';  // the screensaver overlay's style

function emit(line) {
    console.log(`GLYPHTEST ${line}`);
    const s = Gio.File.new_for_path(`${OUT}/results.txt`).append_to(Gio.FileCreateFlags.NONE, null);
    s.write_all(new TextEncoder().encode(`${line}\n`), null);
    s.close(null);
}
const check = (name, ok, detail = '') => emit(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
async function waitFor(cond, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            if (cond())
                return true;
        } catch (e) {}
        await sleep(100);
    }
    return false;
}
const grabbed = () => !!global.stage.get_grab_actor();
const grabInfo = () => {
    const a = global.stage.get_grab_actor();
    return a ? `${a.constructor.name}${a.style ? `[${a.style}]` : ''}` : 'none';
};
const processAlive = pid => !!pid && GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS) &&
    !new TextDecoder().decode(GLib.file_get_contents(`/proc/${pid}/stat`)[1]).includes(') Z');
const moveFile = (from, to) => Gio.File.new_for_path(from).move(Gio.File.new_for_path(to), Gio.FileCopyFlags.NONE, null, null);

export default class GlyphTest extends Extension {
    enable() {
        // GNOME re-enables extensions around lock/unlock; run the suite only once.
        if (globalThis.__glyphTestStarted)
            return;
        globalThis.__glyphTestStarted = true;
        this._run().catch(e => emit(`FAIL driver crashed: ${e}\n${e.stack}`)).finally(() => emit('DONE'));
    }

    disable() {}

    get s() {
        return Main.extensionManager.lookup(UUID)?.stateObj;
    }

    _state() {
        const s = this.s;
        return `overlay=${!!s._overlay} grab=${grabInfo()} painted=${s._painted} proc=${!!s._proc}`;
    }

    _animating() {
        return waitFor(() => this.s._painted && this.s._grid?.effect && this.s._grid.cells.size > 50, 8000);
    }

    async _screenshot(name) {
        try {
            const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            await new Shell.Screenshot().screenshot(false, stream);
            stream.close(null);
        } catch (e) {
            emit(`INFO screenshot ${name} failed: ${e}`);
        }
    }

    _key() {
        const t = GLib.get_monotonic_time();
        this._kb.notify_keyval(t, Clutter.KEY_a, Clutter.KeyState.PRESSED);
        this._kb.notify_keyval(t + 1000, Clutter.KEY_a, Clutter.KeyState.RELEASED);
    }

    // Press keys in order, then release in reverse, like a person pressing a shortcut.
    async _combo(...keyvals) {
        for (const k of keyvals) {
            this._kb.notify_keyval(GLib.get_monotonic_time(), k, Clutter.KeyState.PRESSED);
            await sleep(30);
        }
        for (const k of keyvals.reverse()) {
            this._kb.notify_keyval(GLib.get_monotonic_time(), k, Clutter.KeyState.RELEASED);
            await sleep(30);
        }
    }

    async _moveMouse() {
        // Spread over several frames: Clutter merges motion events within one frame.
        for (let i = 0; i < 6; i++) {
            this._ptr.notify_relative_motion(GLib.get_monotonic_time(), 8, 0);
            await sleep(50);
        }
    }

    _click() {
        const t = GLib.get_monotonic_time();
        this._ptr.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        this._ptr.notify_button(t + 80000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    }

    // Wait until input is armed, act, and expect the screensaver gone with input and engine released.
    async _dismissedBy(name, action) {
        await waitFor(() => this.s._armed, 2000);
        await action();
        const ok = await waitFor(() => !this.s._overlay && !grabbed() && !this.s._proc, 2000);
        check(name, ok, this._state());
        if (!ok)
            this.s._hide(true);  // keep one failure from cascading into the next tests
        await sleep(400);
    }

    // Toggle the monitors' power-save mode over mutter's D-Bus API, as GNOME does when the screen blanks.
    _setPowerSave(mode) {
        return new Promise(resolve => Gio.DBus.session.call(
            'org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.gnome.Mutter.DisplayConfig', 'PowerSaveMode', new GLib.Variant('i', mode)]),
            null, Gio.DBusCallFlags.NONE, -1, null, (c, r) => {
                try {
                    c.call_finish(r);
                    resolve('ok');
                } catch (e) {
                    resolve(e.message);
                }
            }));
    }

    async _run() {
        GLib.mkdir_with_parents(OUT, 0o755);
        await sleep(3000);
        if (Main.overview.visible) {
            Main.overview.hide();
            await waitFor(() => !Main.overview.visible && !Main.overview.animationInProgress, 5000);
            await sleep(500);
        }
        emit(`INFO gnome-shell ${Config.PACKAGE_VERSION}`);
        const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend();
        const seat = backend.get_default_seat();
        this._kb = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

        const ext = Main.extensionManager.lookup(UUID);
        check('extension loads and enables', ext?.state === 1, `state=${ext?.state} error=${ext?.error ?? ''}`);
        if (ext?.state !== 1)
            return;

        // Normal run: overlay up, input grabbed, real terminaltexteffects frames painted.
        this.s._show();
        check('show: overlay + input grab', !!this.s._overlay && grabbed());
        check('show: animation frames painted', await this._animating(),
            `effect=${this.s._grid?.effect} cells=${this.s._grid?.cells.size} grid=${this.s._grid?.cols}x${this.s._grid?.rows}`);
        await sleep(1500);
        await this._screenshot('running');

        // Dismissal by real input events.
        await this._dismissedBy('dismiss: key press', () => this._key());
        this.s._show();
        await this._dismissedBy('dismiss: mouse movement', () => this._moveMouse());
        this.s._show();
        await this._dismissedBy('dismiss: mouse click', () => this._click());

        // Preview button in the settings bumps a key the extension listens to.
        const st = this.s._settings;
        st.set_uint('preview', st.get_uint('preview') + 1);
        check('preview setting opens screensaver', await waitFor(() => !!this.s._overlay, 3000));
        await this._dismissedBy('dismiss after preview', () => this._key());

        // Start shortcut: Super+Alt+G by default, changeable, inactive while the extension is disabled.
        const SUPER = Clutter.KEY_Super_L, ALT = Clutter.KEY_Alt_L;
        check('shortcut: default is Super+Alt+G', JSON.stringify(st.get_strv('start-shortcut')) === '["<Super><Alt>g"]',
            `value=${JSON.stringify(st.get_strv('start-shortcut'))}`);
        await this._combo(SUPER, ALT, Clutter.KEY_g);
        check('shortcut: Super+Alt+G starts it', await waitFor(() => !!this.s._overlay && grabbed(), 2000), this._state());
        check('shortcut: it animates', await this._animating(), this._state());
        await this._dismissedBy('shortcut: dismiss after shortcut start', () => this._key());

        st.set_strv('start-shortcut', ['<Super><Alt>x']);
        await sleep(300);
        await this._combo(SUPER, ALT, Clutter.KEY_g);
        await sleep(1200);
        const oldStillWorks = !!this.s._overlay;
        this.s._hide(true);
        await this._combo(SUPER, ALT, Clutter.KEY_x);
        const newWorks = await waitFor(() => !!this.s._overlay, 2000);
        check('shortcut: changing it takes effect', !oldStillWorks && newWorks, `old-still-works=${oldStillWorks} new-works=${newWorks}`);
        await this._dismissedBy('shortcut: dismiss after new shortcut', () => this._key());

        st.set_strv('start-shortcut', []);
        await sleep(300);
        await this._combo(SUPER, ALT, Clutter.KEY_x);
        await sleep(1200);
        check('shortcut: can be disabled', !this.s._overlay, this._state());
        this.s._hide(true);
        st.reset('start-shortcut');
        await sleep(300);

        this.s.disable();
        await this._combo(SUPER, ALT, Clutter.KEY_g);
        await sleep(1200);
        check('shortcut: inactive while extension is disabled', !this.s._overlay && !grabbed(), this._state());
        this.s.enable();
        await sleep(300);
        await this._combo(SUPER, ALT, Clutter.KEY_g);
        check('shortcut: works again after re-enable', await waitFor(() => !!this.s._overlay, 2000), this._state());
        await this._dismissedBy('shortcut: dismiss after re-enable', () => this._key());

        // Safety: a failure must never leave input grabbed (the GNOME 46 freeze).
        const realSettings = this.s._settings;
        this.s._settings = {
            get_uint() {
                throw new Error('simulated setup failure');
            },
        };
        this.s._show();
        this.s._settings = realSettings;
        check('safety: setup failure leaves input free', !this.s._overlay && !grabbed());

        this.s._startHelper = () => {
            throw new Error('simulated failure after grab');
        };
        this.s._show();
        delete this.s._startHelper;
        check('safety: failure after grab releases input', !this.s._overlay && !grabbed());

        this.s._show();
        if (this.s._grid) {
            this.s._grid.paint = () => {
                throw new Error('simulated paint failure');
            };
        }
        check('safety: paint failure closes screensaver', await waitFor(() => !this.s._overlay && !grabbed(), 3000), this._state());

        this.s._repaint = () => {};
        const t0 = Date.now();
        this.s._show();
        const closed = await waitFor(() => !this.s._overlay && !grabbed(), 6000);
        delete this.s._repaint;
        check('safety: watchdog closes a stuck screensaver', closed, `after ${Date.now() - t0} ms`);

        // Engine missing: a visible message, still dismissable.
        moveFile(VENV, `${VENV}.off`);
        try {
            this.s._show();
            const msg = await waitFor(() => this.s._message && this.s._painted, 6000);
            check('missing engine: shows setup message', msg && !!this.s._overlay, `message=${this.s._message}`);
            await this._screenshot('missing-engine');
            await this._dismissedBy('missing engine: still dismissable', () => this._key());
        } finally {
            moveFile(`${VENV}.off`, VENV);
        }

        // disable() while running, then enable(): what GNOME does around lock/unlock.
        this.s._show();
        await sleep(1000);
        this.s.disable();
        check('disable() while running releases input and cleans up', !grabbed() && !this.s._overlay &&
            !Main.layoutManager.uiGroup.get_children().some(c => c.style === BLACK), this._state());
        this.s.enable();
        this.s._show();
        check('enable() again: animates', await this._animating(), this._state());
        await this._dismissedBy('enable() again: dismissable', () => this._key());

        // Real lock/unlock: the session switches to the lock screen while the screensaver is up.
        this.s._show();
        await sleep(1000);
        Main.sessionMode.pushMode('unlock-dialog');
        await sleep(1500);
        const lockState = Main.extensionManager.lookup(UUID).state;
        check('lock: screensaver closes, extension paused', !grabbed() && !this.s._overlay && lockState !== 1,
            `state=${lockState} ${this._state()}`);
        await this._combo(Clutter.KEY_Super_L, Clutter.KEY_Alt_L, Clutter.KEY_g);
        await sleep(1200);
        check('lock: shortcut does nothing on the lock screen', !this.s._overlay, this._state());
        Main.sessionMode.popMode('unlock-dialog');
        check('unlock: extension active again', await waitFor(() => Main.extensionManager.lookup(UUID)?.state === 1, 5000));
        this.s._show();
        check('unlock: animates again', await this._animating(), this._state());
        await this._dismissedBy('unlock: dismissable', () => this._key());

        // Screen blank: the displays switch off; the screensaver closes and its engine stops.
        this.s._show();
        await waitFor(() => this.s._painted && this.s._proc, 5000);
        const pid = this.s._proc?.get_identifier?.();
        const setRes = await this._setPowerSave(3);
        const off = await waitFor(() => !this.s._overlay && !grabbed() && !this.s._proc, 3000);
        await sleep(500);
        check('displays off: closes and stops the engine', off && !processAlive(pid),
            `set=${setRes} engine-alive=${processAlive(pid)} ${this._state()}`);
        this.s._onIdle();  // what the idle timer would do while the displays are off
        await sleep(500);
        check('displays off: idle timer does not start it', this.s._displayOff === true && !this.s._overlay);
        await this._setPowerSave(0);
        check('displays on again', await waitFor(() => this.s._displayOff === false, 3000));

        // Starting on its own after the idle delay (minimum 30 s).
        this.s._settings.set_uint('idle-delay', 30);
        const idle = await waitFor(() => !!this.s._overlay, 50000);
        check('starts after idle delay', idle);
        if (idle) {
            await waitFor(() => this.s._painted, 4000);
            await this._dismissedBy('dismiss after idle start', () => this._key());
        }

        // Preferences window: the harness opens it once this file exists.
        GLib.file_set_contents(`${OUT}/prefs-ready`, '');
        const titles = () => global.get_window_actors().map(a => a.meta_window.get_title() ?? '');
        const prefs = await waitFor(() => titles().some(t => t.includes('Glyph')), 30000);
        await sleep(3000);
        check('preferences window opens', prefs, `windows=${JSON.stringify(titles())}`);
        await this._screenshot('prefs');
    }
}
