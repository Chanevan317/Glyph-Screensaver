import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {TerminalGrid} from './renderer.js';
import {findPython, displayText, VENV} from './common.js';

const PYTHON = findPython() ?? 'python3';

// Keep in sync with STYLES in helper/tte_stream.py
const STYLES = [
    ['omarchy', 'Omarchy (Delta Corps Priest)'],
    ['shadow', 'ANSI Shadow'],
    ['dos-rebel', 'DOS Rebel'],
    ['bloody', 'Bloody'],
    ['electronic', 'Electronic'],
    ['blocks', 'ANSI Blocks'],
    ['3d', '3D'],
    ['sub-zero', 'Sub-Zero'],
    ['big-money', 'Big Money'],
    ['colossal', 'Colossal'],
    ['graffiti', 'Graffiti'],
    ['slant', 'Slant'],
    ['calvin', 'Calvin S'],
    ['future', 'Future'],
];

// terminaltexteffects effects (Omarchy picks one at random each cycle)
const EFFECTS = {
    beams: 'Beams', binarypath: 'Binary Path', blackhole: 'Black Hole', bouncyballs: 'Bouncy Balls',
    bubbles: 'Bubbles', burn: 'Burn', colorshift: 'Color Shift', crumble: 'Crumble', decrypt: 'Decrypt',
    errorcorrect: 'Error Correct', expand: 'Expand', fireworks: 'Fireworks', highlight: 'Highlight',
    laseretch: 'Laser Etch', matrix: 'Matrix', middleout: 'Middle Out', orbittingvolley: 'Orbiting Volley',
    overflow: 'Overflow', pour: 'Pour', print: 'Print', rain: 'Rain', randomsequence: 'Random Sequence',
    rings: 'Rings', scattered: 'Scattered', slice: 'Slice', slide: 'Slide', smoke: 'Smoke',
    spotlights: 'Spotlights', spray: 'Spray', swarm: 'Swarm', sweep: 'Sweep', synthgrid: 'Synth Grid',
    thunderstorm: 'Thunderstorm', unstable: 'Unstable', vhstape: 'VHS Tape', waves: 'Waves', wipe: 'Wipe',
};

export default class GlyphScreensaverPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const helper = GLib.build_filenamev([this.path, 'helper', 'tte_stream.py']);
        window.set_default_size(640, 820);

        const css = new Gtk.CssProvider();
        css.load_from_string(`
            .ss-preview { background-color: #000000; border-radius: 12px; }
            .ss-art { color: #ffffff; font-family: "Adwaita Mono", monospace; font-size: 8pt; padding: 18px; }
        `);
        const display = Gdk.Display.get_default();
        Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.connect('close-request', () => {
            Gtk.StyleContext.remove_provider_for_display(display, css);
            return false;
        });

        const page = new Adw.PreferencesPage({title: 'Screensaver', icon_name: 'preferences-desktop-screensaver-symbolic'});
        window.add(page);

        // --- dependency check ---
        const warn = new Adw.PreferencesGroup({visible: false});
        warn.add(new Adw.ActionRow({
            title: 'Animation engine not installed',
            subtitle: `Needs terminaltexteffects and pyfiglet. Run this in a terminal, then reopen settings:\npython3 -m venv ${VENV} && ${VENV}/bin/pip install "terminaltexteffects>=0.15,<0.16" pyfiglet`,
            subtitle_selectable: true,
            css_classes: ['error'],
        }));
        page.add(warn);
        try {
            const check = Gio.Subprocess.new([PYTHON, '-I', '-c', 'import terminaltexteffects, pyfiglet'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            check.wait_check_async(null, (p, res) => {
                try {
                    p.wait_check_finish(res);
                } catch (e) {
                    warn.visible = true;
                }
            });
        } catch (e) {
            warn.visible = true;
        }

        // --- preview + live art ---
        const top = new Adw.PreferencesGroup();
        const frame = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC, vscrollbar_policy: Gtk.PolicyType.NEVER,
            css_classes: ['ss-preview'], margin_bottom: 12,
        });
        const art = new Gtk.Label({css_classes: ['ss-art'], xalign: 0.5, selectable: false});
        frame.set_child(art);
        top.add(frame);

        const previewRow = new Adw.ActionRow({
            title: 'Preview',
            subtitle: 'Start the screensaver now. Press any key or move the mouse to exit.',
        });
        const previewBtn = new Gtk.Button({label: 'Preview', valign: Gtk.Align.CENTER, css_classes: ['suggested-action', 'pill']});
        previewBtn.connect('clicked', () => settings.set_uint('preview', settings.get_uint('preview') + 1));
        previewRow.add_suffix(previewBtn);
        previewRow.activatable_widget = previewBtn;
        top.add(previewRow);
        page.add(top);

        const refreshArt = () => {
            try {
                const proc = Gio.Subprocess.new(
                    [PYTHON, '-I', helper, '--render-only', `--text=${displayText(settings)}`, '--style', settings.get_string('font-style')],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, out] = p.communicate_utf8_finish(res);
                        art.label = out.replace(/\n+$/, '');
                    } catch (e) {}
                });
            } catch (e) {
                art.label = 'Preview unavailable';
            }
        };

        // --- Appearance ---
        const look = new Adw.PreferencesGroup({title: 'Appearance'});
        const textRow = new Adw.EntryRow({title: 'Text (empty = your user name)', show_apply_button: true, text: settings.get_string('text')});
        textRow.connect('apply', () => settings.set_string('text', textRow.text.trim()));
        look.add(textRow);

        const styleRow = new Adw.ComboRow({
            title: 'Font style',
            model: Gtk.StringList.new(STYLES.map(s => s[1])),
        });
        const curStyle = Math.max(0, STYLES.findIndex(s => s[0] === settings.get_string('font-style')));
        styleRow.selected = curStyle;
        styleRow.connect('notify::selected', () => settings.set_string('font-style', STYLES[styleRow.selected][0]));
        look.add(styleRow);

        const sizeRow = new Adw.SpinRow({
            title: 'Text size',
            subtitle: 'Terminal font size in points — Omarchy uses 18',
            adjustment: new Gtk.Adjustment({lower: 8, upper: 72, step_increment: 1, page_increment: 4}),
        });
        settings.bind('font-size', sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        look.add(sizeRow);
        page.add(look);

        // --- Behavior ---
        const behave = new Adw.PreferencesGroup({title: 'Behavior'});
        const delayRow = new Adw.SpinRow({
            title: 'Start after',
            subtitle: 'Seconds of inactivity',
            adjustment: new Gtk.Adjustment({lower: 30, upper: 7200, step_increment: 30, page_increment: 300}),
        });
        settings.bind('idle-delay', delayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behave.add(delayRow);
        const fsRow = new Adw.SwitchRow({
            title: 'Pause for fullscreen apps',
            subtitle: 'Don’t start while a fullscreen window (game, video) is focused',
        });
        settings.bind('skip-fullscreen', fsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behave.add(fsRow);
        page.add(behave);

        // --- Effects ---
        const fx = new Adw.PreferencesGroup({
            title: 'Effects',
            description: 'Animations from terminaltexteffects, the same engine and settings Omarchy uses. One enabled effect is picked at random each cycle.',
        });
        const expander = new Adw.ExpanderRow({title: 'Enabled effects'});
        const names = Object.keys(EFFECTS);
        const updateSubtitle = () => {
            const off = settings.get_strv('disabled-effects').filter(n => n in EFFECTS).length;
            expander.subtitle = `${names.length - off} of ${names.length}`;
        };
        for (const name of names) {
            const row = new Adw.SwitchRow({title: EFFECTS[name]});
            const eye = new Gtk.Button({
                icon_name: 'view-reveal-symbolic', valign: Gtk.Align.CENTER,
                tooltip_text: `Preview ${EFFECTS[name]}`, css_classes: ['flat'],
            });
            eye.connect('clicked', () => this._openEffectPreview(window, settings, helper, name, EFFECTS[name]));
            row.add_prefix(eye);
            row.active = !settings.get_strv('disabled-effects').includes(name);
            row.connect('notify::active', () => {
                const set = new Set(settings.get_strv('disabled-effects'));
                if (row.active)
                    set.delete(name);
                else
                    set.add(name);
                settings.set_strv('disabled-effects', [...set]);
                updateSubtitle();
            });
            expander.add_row(row);
        }
        updateSubtitle();
        fx.add(expander);
        page.add(fx);

        settings.connect('changed::text', refreshArt);
        settings.connect('changed::font-style', refreshArt);
        refreshArt();
    }

    /** A window that loops one effect, rendered exactly like the fullscreen screensaver, scaled to fit. */
    _openEffectPreview(parent, settings, helper, name, label) {
        // Lay out the grid for the real screen so the preview matches fullscreen, then scale it down.
        const monitor = Gdk.Display.get_default().get_monitors().get_item(0);
        const geo = monitor?.get_geometry();
        const W = geo?.width || 1920, H = geo?.height || 1080;
        const grid = new TerminalGrid(settings.get_uint('font-size'), W, H);

        const win = new Adw.Window({transient_for: parent, default_width: 960, default_height: 586, title: label});
        const header = new Adw.HeaderBar({
            title_widget: new Adw.WindowTitle({title: label, subtitle: 'Effect preview'}),
            css_classes: ['flat'],
        });
        const area = new Gtk.DrawingArea({hexpand: true, vexpand: true});
        area.set_draw_func((_a, cr, w, h) => {
            cr.setSourceRGB(0, 0, 0);
            cr.paint();
            const s = Math.min(w / W, h / H);
            cr.translate((w - W * s) / 2, (h - H * s) / 2);
            cr.scale(s, s);
            cr.rectangle(0, 0, W, H);
            cr.clip();
            grid.paint(cr);
            cr.$dispose();
        });
        const view = new Adw.ToolbarView({content: area, css_classes: ['ss-preview-window']});
        view.add_top_bar(header);
        win.set_content(view);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval) => {
            if (keyval === Gdk.KEY_Escape)
                win.close();
            return false;
        });
        win.add_controller(keys);

        let proc = null, cancel = new Gio.Cancellable(), dirty = false;
        const cleanup = () => {
            cancel.cancel();
            proc?.force_exit();
            proc = null;
        };
        try {
            proc = Gio.Subprocess.new([PYTHON, '-I', helper,
                `--text=${displayText(settings)}`,
                '--style', settings.get_string('font-style'),
                '--cols', String(grid.cols), '--rows', String(grid.rows),
                '--effect', name], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            const stream = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true});
            const readLine = () => stream.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (s, res) => {
                let line;
                try {
                    [line] = s.read_line_finish_utf8(res);
                } catch (e) {
                    return;
                }
                if (line === null)
                    return;
                if (grid.handleLine(line))
                    dirty = true;
                readLine();
            });
            readLine();
        } catch (e) {
            console.error('glyph-screensaver preview:', e);
        }
        area.add_tick_callback(() => {
            if (dirty) {
                dirty = false;
                area.queue_draw();
            }
            return GLib.SOURCE_CONTINUE;
        });
        win.connect('close-request', () => {
            cleanup();
            return false;
        });
        win.connect('destroy', cleanup);
        win.present();
    }
}
