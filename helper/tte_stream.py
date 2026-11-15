"""Frame streamer for the Glyph Screensaver GNOME extension.

Runs terminaltexteffects (tte) exactly like Omarchy's screensaver loop:
    tte -i screensaver.txt --frame-rate 120 --canvas-width 0 --canvas-height 0 --reuse-canvas
        --anchor-canvas c --anchor-text c --random-effect --no-eol --no-restore-cursor
but instead of writing ANSI to a terminal, it reports each frame's changed cells to stdout:

    N <effect>                      new effect starting
    C                               clear the canvas
    F x,y,codepoint,fg,bg,dim;...   frame diff (x,y from top-left; fg/bg = RRGGBB or empty)

Also: --render-only prints the generated ASCII art (used by the preferences preview).
"""
import argparse
import random
import signal
import sys
import time

STYLES = {
    'omarchy': 'delta_corps_priest_1',
    'shadow': 'ansi_shadow',
    'dos-rebel': 'dos_rebel',
    'bloody': 'bloody',
    'electronic': 'electronic',
    'blocks': 'ansi_regular',
    '3d': '3d-ascii',
    'sub-zero': 'sub-zero',
    'big-money': 'big_money-ne',
    'colossal': 'colossal',
    'graffiti': 'graffiti',
    'slant': 'slant',
    'calvin': 'calvin_s',
    'future': 'future',
}


def die_with_parent():
    try:
        import ctypes
        ctypes.CDLL('libc.so.6').prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG
    except Exception:
        pass


def render_art(text, style):
    import pyfiglet
    art = pyfiglet.figlet_format(text, font=STYLES.get(style, STYLES['omarchy']), width=10000)
    lines = [ln.rstrip() for ln in art.split('\n')]
    while lines and not lines[-1].strip():
        lines.pop()
    while lines and not lines[0].strip():
        lines.pop(0)
    return '\n'.join(lines)


def color(code):
    if isinstance(code, str):
        return code.lstrip('#')
    return ''  # 8-bit xterm codes are not used with the default config


def stream(art, cols, rows, exclude, only=None):
    sys.argv = ['tte', '--frame-rate', '120', '--canvas-width', str(cols), '--canvas-height', str(rows),
                '--anchor-canvas', 'c', '--anchor-text', 'c', '--ignore-terminal-dimensions',
                '--random-effect', '--no-eol', '--no-restore-cursor']
    from terminaltexteffects.__main__ import build_parsers_and_parse_args
    from terminaltexteffects.engine.terminal import TerminalConfig
    args, effect_map = build_parsers_and_parse_args()
    available = [e for e in effect_map if e not in exclude] or list(effect_map)
    if only in effect_map:
        available = [only]  # single-effect preview: loop just this one
    out = sys.stdout
    while True:
        name = random.choice(available)
        effect_cls, config_cls = effect_map[name]
        effect = effect_cls(art, config_cls._build_config(None), TerminalConfig._build_config(args))
        out.write(f'N {name}\nC\n')
        prev = {}
        it = iter(effect)
        for _ in it:  # each step advances one frame and enforces 120 fps
            term = it.terminal
            top, roff, coff = term.visible_top, term.canvas_row_offset, term.canvas_column_offset
            cur = {}
            for ch in sorted(term._visible_characters, key=lambda c: c.layer):
                row = ch.motion.current_coord.row + roff
                col = ch.motion.current_coord.column + coff
                if term.visible_bottom <= row <= top and term.visible_left <= col <= term.visible_right:
                    v = ch.animation.current_character_visual
                    cur[(col - 1, top - row)] = (ord(v.symbol[0]) if v.symbol else 32,
                                                 color(v._fg_color_code), color(v._bg_color_code),
                                                 '1' if v.dim else '')
            parts = [f'{k[0]},{k[1]},{val[0]},{val[1]},{val[2]},{val[3]}'
                     for k, val in cur.items() if prev.get(k) != val]
            parts += [f'{k[0]},{k[1]},32,,,' for k in prev.keys() - cur.keys()]
            out.write('F ' + ';'.join(parts) + '\n')
            out.flush()
            prev = cur
        # Omarchy polls once a second before starting the next effect: hold the final frame briefly.
        time.sleep(random.uniform(0.4, 1.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--text', default='HELLO')
    ap.add_argument('--style', default='omarchy')
    ap.add_argument('--cols', type=int, default=133)
    ap.add_argument('--rows', type=int, default=34)
    ap.add_argument('--exclude', default='')
    ap.add_argument('--effect', default=None, help='play only this effect (used by the effect previews)')
    ap.add_argument('--render-only', action='store_true')
    a = ap.parse_args()
    art = render_art(a.text, a.style)
    if a.render_only:
        print(art)
        return
    die_with_parent()
    try:
        stream(art, a.cols, a.rows, set(filter(None, a.exclude.split(','))), a.effect)
    except (BrokenPipeError, KeyboardInterrupt):
        pass


if __name__ == '__main__':
    main()
