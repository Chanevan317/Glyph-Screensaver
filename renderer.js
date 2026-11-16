// Terminal-grid renderer: turns the helper's frame stream into pixels, the way Alacritty draws a
// terminal (fixed cells, built-in block/box-drawing glyphs). No Shell imports, so it can be tested
// standalone with gjs.
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Cairo from 'cairo';

// Adwaita fonts ship with GNOME 48+; older releases and other distros fall back to the generic family.
function pickFamily(preferred, generic) {
    try {
        const families = PangoCairo.FontMap.get_default().list_families();
        if (families.some(f => f.get_name() === preferred))
            return preferred;
    } catch (e) {}
    return generic;
}
export const MONO = pickFamily('Adwaita Mono', 'Monospace');
export const SANS = pickFamily('Adwaita Sans', 'Sans');
const DEFAULT_FG = [0.88, 0.88, 0.88];

const QUADS = { // [UL, UR, LL, LR]
    0x2596: [0, 0, 1, 0], 0x2597: [0, 0, 0, 1], 0x2598: [1, 0, 0, 0], 0x2599: [1, 0, 1, 1],
    0x259A: [1, 0, 0, 1], 0x259B: [1, 1, 1, 0], 0x259C: [1, 1, 0, 1], 0x259D: [0, 1, 0, 0],
    0x259E: [0, 1, 1, 0], 0x259F: [0, 1, 1, 1],
};
const LINES = { // [up, right, down, left]: 1 light, 2 heavy
    0x2500: [0, 1, 0, 1], 0x2502: [1, 0, 1, 0], 0x250C: [0, 1, 1, 0], 0x2510: [0, 0, 1, 1],
    0x2514: [1, 1, 0, 0], 0x2518: [1, 0, 0, 1], 0x251C: [1, 1, 1, 0], 0x2524: [1, 0, 1, 1],
    0x252C: [0, 1, 1, 1], 0x2534: [1, 1, 0, 1], 0x253C: [1, 1, 1, 1],
    0x2501: [0, 2, 0, 2], 0x2503: [2, 0, 2, 0], 0x250F: [0, 2, 2, 0], 0x2513: [0, 0, 2, 2],
    0x2517: [2, 2, 0, 0], 0x251B: [2, 0, 0, 2], 0x2523: [2, 2, 2, 0], 0x252B: [2, 0, 2, 2],
    0x2533: [0, 2, 2, 2], 0x253B: [2, 2, 0, 2], 0x254B: [2, 2, 2, 2],
    0x2574: [0, 0, 0, 1], 0x2575: [1, 0, 0, 0], 0x2576: [0, 1, 0, 0], 0x2577: [0, 0, 1, 0],
    0x2578: [0, 0, 0, 2], 0x2579: [2, 0, 0, 0], 0x257A: [0, 2, 0, 0], 0x257B: [0, 0, 2, 0],
};
// Double lines as segments: axis, offset (±gap), from, to — '0'/'1' cell edges, '-'/'+' centre ∓ gap
const DOUBLES = {
    0x2550: 'h-01 h+01', 0x2551: 'v-01 v+01',
    0x2554: 'h--1 h++1 v--1 v++1', 0x2557: 'h-0+ h+0- v+-1 v-+1',
    0x255A: 'h+-1 h-+1 v-0+ v+0-', 0x255D: 'h+0+ h-0- v+0+ v-0-',
    0x2560: 'v-01 v+0- v++1 h-+1 h++1', 0x2563: 'v+01 v-0- v-+1 h-0- h+0-',
    0x2566: 'h-01 h+0- h++1 v-+1 v++1', 0x2569: 'h+01 h-0- h-+1 v-0- v+0-',
    0x256C: 'h-0- h-+1 h+0- h++1 v-0- v-+1 v+0- v++1',
};

/** Adds the cell's shape to the path. Returns true (fill it), 'shade', or false (use a font glyph). */
function builtinPath(cr, cp, x0, y0, x1, y1) {
    const w = x1 - x0, h = y1 - y0;
    const rect = (ax, ay, bx, by) => cr.rectangle(ax, ay, bx - ax, by - ay);
    if (cp === 0x2588) {
        rect(x0, y0, x1, y1);
    } else if (cp >= 0x2581 && cp <= 0x2587) {
        rect(x0, y1 - Math.round(h * (cp - 0x2580) / 8), x1, y1);
    } else if (cp === 0x2580) {
        rect(x0, y0, x1, y0 + Math.round(h / 2));
    } else if (cp >= 0x2589 && cp <= 0x258F) {
        rect(x0, y0, x0 + Math.round(w * (8 - (cp - 0x2588)) / 8), y1);
    } else if (cp === 0x2590) {
        rect(x0 + Math.round(w / 2), y0, x1, y1);
    } else if (cp === 0x2594) {
        rect(x0, y0, x1, y0 + Math.max(1, Math.round(h / 8)));
    } else if (cp === 0x2595) {
        rect(x1 - Math.max(1, Math.round(w / 8)), y0, x1, y1);
    } else if (QUADS[cp]) {
        const mx = x0 + Math.round(w / 2), my = y0 + Math.round(h / 2), q = QUADS[cp];
        if (q[0]) rect(x0, y0, mx, my);
        if (q[1]) rect(mx, y0, x1, my);
        if (q[2]) rect(x0, my, mx, y1);
        if (q[3]) rect(mx, my, x1, y1);
    } else if (LINES[cp]) {
        const t1 = Math.max(1, Math.round(w / 8)), [u, r, d, l] = LINES[cp];
        const cx = x0 + Math.floor(w / 2), cy = y0 + Math.floor(h / 2);
        const th = k => (k === 2 ? t1 * 2 : t1);
        const m = Math.max(th(u), th(r), th(d), th(l)) / 2;
        if (u) rect(cx - th(u) / 2, y0, cx + th(u) / 2, cy + m);
        if (d) rect(cx - th(d) / 2, cy - m, cx + th(d) / 2, y1);
        if (l) rect(x0, cy - th(l) / 2, cx + m, cy + th(l) / 2);
        if (r) rect(cx - m, cy - th(r) / 2, x1, cy + th(r) / 2);
    } else if (DOUBLES[cp]) {
        const t = Math.max(1, Math.round(w / 9)), g = Math.max(t, Math.round(w / 6));
        const cx = x0 + Math.floor(w / 2), cy = y0 + Math.floor(h / 2);
        const inner = v => v === '-' || v === '+';
        for (const [axis, off, a, b] of DOUBLES[cp].split(' ')) {
            const o = off === '-' ? -g : g;
            const [e0, e1, c] = axis === 'h' ? [x0, x1, cx] : [y0, y1, cy];
            const pos = v => (v === '0' ? e0 : v === '1' ? e1 : v === '-' ? c - g : c + g);
            const [lv, hv] = pos(a) <= pos(b) ? [a, b] : [b, a];
            const lo = pos(lv) - (inner(lv) ? t / 2 : 0), hi = pos(hv) + (inner(hv) ? t / 2 : 0);
            if (axis === 'h')
                rect(lo, cy + o - t / 2, hi, cy + o + t / 2);
            else
                rect(cx + o - t / 2, lo, cx + o + t / 2, hi);
        }
    } else if (cp >= 0x2591 && cp <= 0x2593) {
        return 'shade';
    } else {
        return false;
    }
    return true;
}

export class TerminalGrid {
    /**
     * Cell metrics like a terminal: font size in points -> pixels at 96 dpi.
     * `scale` is the UI scale when width/height are physical pixels (X11 HiDPI); 1 otherwise.
     */
    constructor(fontSizePt, width, height, scale = 1) {
        const px = fontSizePt * 96 / 72 * scale;
        // Font metrics come from Pango: GJS's cairo binding has no fontExtents() before GNOME 47.
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
        const cr = new Cairo.Context(surf);
        const fd = Pango.FontDescription.from_string(MONO);
        fd.set_absolute_size(px * Pango.SCALE);
        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(fd);
        const metrics = layout.get_context().get_metrics(fd, null);
        const ascent = metrics.get_ascent() / Pango.SCALE;
        const descent = metrics.get_descent() / Pango.SCALE;
        cr.selectFontFace(MONO, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(px);
        const cw = cr.textExtents('M').xAdvance;
        cr.$dispose();
        if (!(cw > 0 && ascent > 0))
            throw new Error(`glyph-screensaver: bad font metrics for "${MONO}"`);
        this.px = px;
        this.cw = cw;
        this.ch = Math.ceil(ascent + descent);
        this.ascent = ascent;
        this.cols = Math.max(20, Math.floor(width / cw));
        this.rows = Math.max(8, Math.floor(height / this.ch));
        this.ox = Math.floor((width - this.cols * cw) / 2);
        this.oy = Math.floor((height - this.rows * this.ch) / 2);
        this.cells = new Map();
        this._colors = new Map();
        this._layouts = new Map();
        this.effect = null;
    }

    _rgb(hex) {
        if (!hex)
            return null;
        let c = this._colors.get(hex);
        if (!c) {
            c = [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
            this._colors.set(hex, c);
        }
        return c;
    }

    /** Apply one protocol line from helper/tte_stream.py. Returns true if the picture changed. */
    handleLine(line) {
        const kind = line[0];
        if (kind === 'F') {
            if (line.length > 2) {
                for (const part of line.slice(2).split(';')) {
                    const f = part.split(',');
                    const key = +f[1] * this.cols + +f[0], cp = +f[2];
                    if (cp === 32 && !f[4])
                        this.cells.delete(key);
                    else
                        this.cells.set(key, {cp, fg: this._rgb(f[3]) ?? DEFAULT_FG, bg: this._rgb(f[4]), dim: f[5] === '1'});
                }
            }
            return true;
        }
        if (kind === 'C') {
            this.cells.clear();
            return true;
        }
        if (kind === 'N')
            this.effect = line.slice(2);
        return false;
    }

    _glyph(cr, cp, x, y) {
        if (cp < 0x0250) {
            cr.moveTo(x, y + this.ascent);
            cr.showText(String.fromCodePoint(cp));
            return;
        }
        // Other symbols go through Pango so font fallback finds a glyph.
        let layout = this._layouts.get(cp);
        if (!layout) {
            layout = PangoCairo.create_layout(cr);
            const fd = Pango.FontDescription.from_string(MONO);
            fd.set_absolute_size(this.px * Pango.SCALE);
            layout.set_font_description(fd);
            layout.set_text(String.fromCodePoint(cp), -1);
            this._layouts.set(cp, layout);
        }
        PangoCairo.update_layout(cr, layout);
        cr.moveTo(x, y + this.ascent - layout.get_baseline() / Pango.SCALE);
        PangoCairo.show_layout(cr, layout);
    }

    paint(cr) {
        cr.setSourceRGB(0, 0, 0);
        cr.paint();
        cr.selectFontFace(MONO, Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(this.px);
        for (const [key, cell] of this.cells) {
            const col = key % this.cols, row = (key - col) / this.cols;
            const x0 = Math.round(this.ox + col * this.cw), x1 = Math.round(this.ox + (col + 1) * this.cw);
            const y0 = this.oy + row * this.ch, y1 = y0 + this.ch;
            if (cell.bg) {
                cr.setSourceRGB(cell.bg[0], cell.bg[1], cell.bg[2]);
                cr.rectangle(x0, y0, x1 - x0, y1 - y0);
                cr.fill();
            }
            if (cell.cp === 32)
                continue;
            const a = cell.dim ? 0.6 : 1;
            cr.setSourceRGBA(cell.fg[0], cell.fg[1], cell.fg[2], a);
            const b = builtinPath(cr, cell.cp, x0, y0, x1, y1);
            if (b === true) {
                cr.fill();
            } else if (b === 'shade') {
                cr.setSourceRGBA(cell.fg[0], cell.fg[1], cell.fg[2], a * (cell.cp - 0x2590) * 0.25);
                cr.rectangle(x0, y0, x1 - x0, y1 - y0);
                cr.fill();
            } else {
                this._glyph(cr, cell.cp, x0, y0);
            }
        }
    }
}
