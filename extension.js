// Glyph Screensaver — Omarchy's screensaver, drawn natively by GNOME Shell.
//
// helper/tte_stream.py runs terminaltexteffects with Omarchy's exact settings and streams each
// frame's cells; renderer.js paints them on a pure-black fullscreen overlay the way Alacritty would.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TerminalGrid, SANS} from './renderer.js';
import {findPython, displayText} from './common.js';

const ARM_DELAY = 700;      // ms before input dismisses (so the Preview click doesn't close it)
const MOVE_THRESHOLD = 12;  // px of mouse travel that counts as activity
const MISSING_ENGINE = 'Glyph Screensaver needs terminaltexteffects — open the extension settings for setup.';

export default class GlyphScreensaverExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        // GNOME 46+: global.backend.get_core_idle_monitor(); GNOME 45: Meta.IdleMonitor.get_core()
        this._idleMonitor = global.backend?.get_core_idle_monitor?.() ?? Meta.IdleMonitor.get_core();
        this._idleWatch = 0;
        this._timeouts = new Set();
        this._settingsIds = [
            this._settings.connect('changed::idle-delay', () => this._armIdleWatch()),
            this._settings.connect('changed::preview', () => this._later(600, () => this._show())),
        ];
        this._sessionId = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked)
                this._hide(true);
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._hide(true));
        this._armIdleWatch();
    }

    disable() {
        this._hide(true);
        if (this._idleWatch)
            this._idleMonitor.remove_watch(this._idleWatch);
        this._idleWatch = 0;
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        Main.sessionMode.disconnect(this._sessionId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._timeouts.clear();
        this._settings = null;
        this._idleMonitor = null;
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _armIdleWatch() {
        if (this._idleWatch)
            this._idleMonitor.remove_watch(this._idleWatch);
        this._idleWatch = this._idleMonitor.add_idle_watch(this._settings.get_uint('idle-delay') * 1000, () => this._onIdle());
    }

    _onIdle() {
        if (this._overlay || Main.sessionMode.isLocked || Main.sessionMode.currentMode !== 'user')
            return;
        if (this._settings.get_boolean('skip-fullscreen') && global.display.focus_window?.is_fullscreen())
            return;
        // Respect apps that inhibit idle (video players, presentations, calls).
        Gio.DBus.session.call(
            'org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager',
            'IsInhibited', new GLib.Variant('(u)', [8]), new GLib.VariantType('(b)'),
            Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                let inhibited = false;
                try {
                    [inhibited] = conn.call_finish(res).deepUnpack();
                } catch (e) {}
                if (!inhibited && this._settings && this._idleMonitor.get_idletime() > 1000)
                    this._show();
            });
    }

    // ---------- overlay ----------

    _show() {
        if (this._overlay || !this._settings || Main.sessionMode.isLocked)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        this._overlay = new St.Widget({
            reactive: true, can_focus: true, opacity: 0,
            x: 0, y: 0, width: global.stage.width, height: global.stage.height,
            style: 'background-color: #000000;',
        });
        this._area = new St.DrawingArea({x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height});
        this._overlay.add_child(this._area);
        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, null);
        // If the shell tears the overlay down itself (e.g. at shutdown), clean up with it.
        const overlay = this._overlay;
        overlay.connect('destroy', () => {
            if (this._overlay === overlay)
                this._hide(true);
        });

        this._grab = Main.pushModal(this._overlay, {actionMode: Shell.ActionMode.NONE});
        if (!this._grab) {
            this._hide(true);
            return;
        }
        this._overlay.grab_key_focus();

        // On X11 HiDPI the stage is in physical pixels and St scales the UI; elsewhere this is 1.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._grid = new TerminalGrid(this._settings.get_uint('font-size'), monitor.width, monitor.height, scale);
        this._message = null;
        this._area.connect('repaint', a => this._repaint(a));
        this._startHelper();

        this._armed = false;
        this._motionOrigin = null;
        this._later(ARM_DELAY, () => (this._armed = true));
        this._overlay.connect('captured-event', (_a, ev) => this._onEvent(ev));

        this._dirty = true;
        this._timeline = new Clutter.Timeline({actor: this._area, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => {
            if (this._dirty && this._area) {
                this._dirty = false;
                this._area.queue_repaint();
            }
        });
        this._timeline.start();

        this._setCursorHidden(true);
        this._overlay.ease({opacity: 255, duration: 350, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _hide(immediate = false) {
        if (!this._overlay)
            return;
        const overlay = this._overlay;
        this._overlay = null;
        this._stopHelper();
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._setCursorHidden(false);
        const finish = () => {
            this._timeline?.stop();
            this._timeline = null;
            this._area = null;
            this._grid = null;
            overlay.destroy();
        };
        if (immediate)
            finish();
        else
            overlay.ease({opacity: 0, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: finish});
    }

    _onEvent(ev) {
        if (!this._armed)
            return Clutter.EVENT_STOP;
        switch (ev.type()) {
        case Clutter.EventType.KEY_PRESS:
        case Clutter.EventType.BUTTON_PRESS:
        case Clutter.EventType.TOUCH_BEGIN:
        case Clutter.EventType.SCROLL:
            this._hide();
            break;
        case Clutter.EventType.MOTION: {
            const [x, y] = ev.get_coords();
            if (!this._motionOrigin)
                this._motionOrigin = [x, y];
            else if (Math.hypot(x - this._motionOrigin[0], y - this._motionOrigin[1]) > MOVE_THRESHOLD)
                this._hide();
            break;
        }
        }
        return Clutter.EVENT_STOP;
    }

    _setCursorHidden(hidden) {
        try {
            // GNOME 46+: backend cursor tracker; GNOME 45: per-display tracker
            const tracker = global.backend?.get_cursor_tracker?.() ?? Meta.CursorTracker.get_for_display(global.display);
            if (hidden === !!this._cursorHidden)
                return;
            if (tracker.inhibit_cursor_visibility) {
                if (hidden)
                    tracker.inhibit_cursor_visibility();
                else
                    tracker.uninhibit_cursor_visibility();
            } else {
                tracker.set_pointer_visible(!hidden);
            }
            this._cursorHidden = hidden;
        } catch (e) {
            this._cursorHidden = false;
        }
    }

    // ---------- tte helper process ----------

    _startHelper() {
        const helper = GLib.build_filenamev([this.path, 'helper', 'tte_stream.py']);
        const python = findPython();
        const argv = [python, '-I', helper,
            `--text=${displayText(this._settings)}`,  // '=' so text starting with '-' isn't read as a flag
            '--style', this._settings.get_string('font-style'),
            '--cols', String(this._grid.cols), '--rows', String(this._grid.rows),
            '--exclude', this._settings.get_strv('disabled-effects').join(',')];
        try {
            if (!python)
                throw new Error('python3 not found');
            this._proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            this._message = MISSING_ENGINE;
            this._dirty = true;
            return;
        }
        this._cancel = new Gio.Cancellable();
        this._stdout = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe(), close_base_stream: true});
        this._readLine();
    }

    _stopHelper() {
        this._cancel?.cancel();
        this._proc?.force_exit();
        this._proc = null;
        this._stdout = null;
        this._cancel = null;
    }

    _readLine() {
        const stream = this._stdout, cancel = this._cancel;
        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (s, res) => {
            let line;
            try {
                [line] = s.read_line_finish_utf8(res);
            } catch (e) {
                return;
            }
            if (cancel.is_cancelled() || !this._grid)
                return;
            if (line === null) {
                // Helper exited before animating: most likely terminaltexteffects/pyfiglet are missing.
                if (!this._grid.effect) {
                    this._message = MISSING_ENGINE;
                    this._dirty = true;
                }
                return;
            }
            if (this._grid.handleLine(line))
                this._dirty = true;
            this._readLine();
        });
    }

    _repaint(area) {
        const cr = area.get_context();
        try {
            if (this._message) {
                cr.setSourceRGB(0, 0, 0);
                cr.paint();
                cr.selectFontFace(SANS, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(18 * St.ThemeContext.get_for_stage(global.stage).scale_factor);
                cr.setSourceRGB(0.7, 0.7, 0.7);
                cr.moveTo(40, area.height / 2);
                cr.showText(this._message);
            } else if (this._grid) {
                this._grid.paint(cr);
            }
        } catch (e) {
            console.error('glyph-screensaver:', e);
        } finally {
            cr.$dispose();
        }
    }
}
