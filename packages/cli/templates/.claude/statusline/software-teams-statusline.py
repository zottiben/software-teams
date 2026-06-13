#!/usr/bin/env python3
"""Software Teams statusline — Vice City aesthetic, Nerd Font icons.

Ships with Software Teams. Shows the standard model / branch / context line plus
a Software Teams ORCHESTRATION line (plan · phase · wave · task · flags) read
from `.software-teams/state.yaml` in the session's working directory.

Style adapted from the user's personal statusline (truecolor neon palette,
rounded box, gradient bars). Stdlib-only (no PyYAML) and fully defensive — it
never raises; on any error it degrades to a minimal line so Claude Code's
statusline is never broken.

Enable with `/st:statusline` (or `software-teams statusline --install`).
"""
import json
import os
import re
import subprocess
import sys


# ── Vice City palette (truecolor) ───────────────────────────────────
def tc(r, g, b):
    return f'\033[38;2;{r};{g};{b}m'


NEON_PINK = tc(255, 110, 199)
HOT_MAG = tc(255, 0, 144)
NEON_CYAN = tc(0, 255, 255)
ELECTRIC = tc(0, 191, 255)
VIOLET = tc(125, 86, 244)
SUNSET = tc(255, 107, 53)
PALM = tc(4, 181, 117)
CHROME = tc(230, 230, 250)
DIM_PURP = tc(90, 70, 110)
BAR_DIM = tc(60, 50, 75)
RESET = '\033[0m'
BOLD = '\033[1m'

# ── Nerd Font icons ─────────────────────────────────────────────────
ICON_MODEL = '\U000f09e1'   # 󰧑 brain
ICON_INPUT = '\U000f005d'   # 󰁝 arrow up
ICON_BRANCH = ''      #  git branch
ICON_PLAN = ''        #  list-ul
ICON_PHASE = ''       #  sitemap
ICON_WAVE = ''        #  wave / flow
ICON_TASK = ''        #  check
ICON_BLOCK = ''       #  warning triangle
ICON_PAUSE = ''       #  pause (checkpoint awaiting)
ICON_TREE = ''        #  code-fork (worktree)

BAR_FILL = '█'   # █
BAR_HALF = '▄'   # ▄
BAR_EMPTY = '░'  # ░


def visible_len(s):
    return len(re.sub(r'\033\[[0-9;]*m', '', s))


def truncate(s, maxlen):
    if len(s) <= maxlen:
        return s
    return s[:maxlen - 1] + '…'


def fmt_k(n):
    return f"{n // 1000}k"


def context_bar(pct, count=8):
    """Gradient bar: cyan -> sunset -> magenta by segment position."""
    step = 100 / count
    bar = ""
    for i in range(count):
        seg_start = i * step
        color = HOT_MAG if seg_start >= 75 else SUNSET if seg_start >= 50 else NEON_CYAN
        progress = pct - seg_start
        if progress >= step * 0.8:
            bar += f"{color}{BAR_FILL}{RESET}"
        elif progress >= step * 0.3:
            bar += f"{color}{BAR_HALF}{RESET}"
        else:
            bar += f"{BAR_DIM}{BAR_EMPTY}{RESET}"
    return bar


def progress_bar(done, total, count=6):
    """Solid palm-green progress bar for task completion."""
    if total <= 0:
        return f"{BAR_DIM}{BAR_EMPTY * count}{RESET}"
    filled = min(count, max(0, round(done * count / total)))
    return f"{PALM}{BAR_FILL * filled}{BAR_DIM}{BAR_EMPTY * (count - filled)}{RESET}"


def build_table(lines):
    max_w = max(visible_len(l) for l in lines)
    bdr = DIM_PURP
    rule = '─' * (max_w + 2)
    rows = [f"{bdr}╭{rule}╮{RESET}"]
    for i, line in enumerate(lines):
        p = max_w - visible_len(line)
        rows.append(f"{bdr}│{RESET} {line}{' ' * p} {bdr}│{RESET}")
        if i < len(lines) - 1:
            rows.append(f"{bdr}├{rule}┤{RESET}")
    rows.append(f"{bdr}╰{rule}╯{RESET}")
    return '\n'.join(rows)


def get_git_branch(cwd):
    if not cwd:
        return ''
    try:
        r = subprocess.run(['git', '-C', cwd, 'branch', '--show-current'],
                           capture_output=True, text=True, timeout=3)
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return ''


def calc_context_from_transcript(transcript_path):
    """Most-accurate context size from the transcript tail (last usage entry)."""
    if not transcript_path or not os.path.isfile(transcript_path):
        return 0
    try:
        with open(transcript_path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(size - min(size, 65536))
            tail = f.read().decode('utf-8', errors='replace')
        last = None
        for line in tail.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (m.get('message', {}).get('usage')
                    and not m.get('isSidechain', False)
                    and not m.get('isApiErrorMessage', False)):
                last = m['message']['usage']
        if not last:
            return 0
        return ((last.get('input_tokens') or 0)
                + (last.get('cache_read_input_tokens') or 0)
                + (last.get('cache_creation_input_tokens') or 0))
    except Exception:
        return 0


# ── Minimal state.yaml reader (no PyYAML) ───────────────────────────
def _coerce(v):
    v = v.strip()
    if v in ('null', '~', ''):
        return None
    if v == 'true':
        return True
    if v == 'false':
        return False
    if v in ('[]', '{}'):
        return []
    if re.fullmatch(r'-?\d+', v):
        return int(v)
    return v.strip('"\'')


def read_state(cwd):
    """Read the scalar fields the statusline needs from .software-teams/state.yaml.

    state.yaml is machine-written by Software Teams in a stable 2-space-indented
    `key: value` format, so a tiny indentation parser suffices. List items are
    ignored for the nested map; `count_list` handles list lengths separately.
    Returns (state_dict, raw_text) or (None, '') when not an ST project.
    """
    path = os.path.join(cwd or '.', '.software-teams', 'state.yaml')
    if not os.path.isfile(path):
        return None, ''
    try:
        text = open(path).read()
    except Exception:
        return None, ''
    root = {}
    stack = [(-1, root)]
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith('#') or raw.lstrip().startswith('- '):
            continue
        m = re.match(r'^(\s*)([\w-]+):\s?(.*)$', raw)
        if not m:
            continue
        indent, key, val = len(m.group(1)), m.group(2), m.group(3)
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]
        if val == '':
            d = {}
            parent[key] = d
            stack.append((indent, d))
        else:
            parent[key] = _coerce(val)
    return root, text


def count_list(text, key):
    """Count `- ` items directly under a top-level `key:` block."""
    in_block, key_indent, n = False, 0, 0
    for raw in text.splitlines():
        if re.match(rf'^(\s*){key}:\s*$', raw):
            in_block, key_indent = True, len(raw) - len(raw.lstrip(' '))
            continue
        if in_block:
            if not raw.strip():
                continue
            indent = len(raw) - len(raw.lstrip(' '))
            if indent <= key_indent:
                break
            if raw.lstrip().startswith('- '):
                n += 1
    return n


STATUS_COLOR = {
    'idle': DIM_PURP,
    'planning': NEON_CYAN,
    'planned': NEON_CYAN,
    'approved': ELECTRIC,
    'executing': NEON_PINK,
    'reviewing': VIOLET,
    'complete': PALM,
    'completed': PALM,
    'blocked': HOT_MAG,
    'paused': SUNSET,
}


def st_line(cwd):
    """Build the Software Teams orchestration line, or '' if not an ST project."""
    state, text = read_state(cwd)
    if not state:
        return ''
    sep = f" {DIM_PURP}│{RESET} "
    pos = state.get('position', {}) if isinstance(state.get('position'), dict) else {}
    prog = state.get('progress', {}) if isinstance(state.get('progress'), dict) else {}
    waves = (state.get('current_phase', {}) or {}).get('waves', {}) if isinstance(state.get('current_phase'), dict) else {}
    wt = state.get('worktree', {}) if isinstance(state.get('worktree'), dict) else {}
    cp = state.get('checkpoints', {}) if isinstance(state.get('checkpoints'), dict) else {}

    status = (pos.get('status') or 'idle')
    scol = STATUS_COLOR.get(str(status).lower(), CHROME)

    parts = []

    plan = pos.get('plan_name') or pos.get('plan')
    if plan:
        parts.append(f"{NEON_PINK}{ICON_PLAN}{RESET} {CHROME}{truncate(str(plan), 28)}{RESET} "
                     f"{scol}({status}){RESET}")
    else:
        parts.append(f"{DIM_PURP}{ICON_PLAN} no active plan{RESET}")

    phase = pos.get('phase_name') or pos.get('phase')
    if phase:
        seg = f"{ELECTRIC}{ICON_PHASE}{RESET} {CHROME}{truncate(str(phase), 20)}{RESET}"
        tw = waves.get('total_waves') or 0
        cw = waves.get('current_wave')
        if isinstance(tw, int) and tw > 0:
            seg += f" {VIOLET}{ICON_WAVE}{cw if cw is not None else '?'}/{tw}{RESET}"
        parts.append(seg)

    tt = prog.get('tasks_total') or 0
    tdone = prog.get('tasks_completed') or 0
    if isinstance(tt, int) and tt > 0:
        parts.append(f"{PALM}{ICON_TASK}{RESET} {progress_bar(tdone, tt)} "
                     f"{CHROME}{tdone}/{tt}{RESET}")

    # Flags
    flags = []
    if wt.get('active'):
        wb = wt.get('branch')
        flags.append(f"{SUNSET}{ICON_TREE}{(' ' + truncate(str(wb), 16)) if wb else ''}{RESET}")
    blockers = count_list(text, 'blockers')
    if blockers:
        flags.append(f"{HOT_MAG}{ICON_BLOCK} {blockers}{RESET}")
    if cp.get('awaiting_response'):
        flags.append(f"{SUNSET}{ICON_PAUSE} checkpoint{RESET}")
    if flags:
        parts.append(' '.join(flags))

    return sep.join(parts)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        print(f"{DIM_PURP}software-teams: waiting for data...{RESET}")
        return

    sep = f" {DIM_PURP}│{RESET} "

    model = (data.get('model', {}) or {}).get('display_name', 'Unknown')
    ctx = data.get('context_window', {}) or {}
    ctx_size = int(ctx.get('context_window_size', 200000) or 200000)
    transcript = data.get('transcript_path') or ''
    context_length = calc_context_from_transcript(transcript)
    if context_length > 0:
        ctx_pct = min(100, context_length * 100 // ctx_size)
        prefix, cur_k = "", context_length // 1000
    else:
        baseline = 20000
        ctx_pct = min(100, baseline * 100 // ctx_size)
        prefix, cur_k = "~", baseline // 1000
    max_k = ctx_size // 1000

    cwd = data.get('cwd', '') or os.getcwd()
    branch = truncate(get_git_branch(cwd), 20)
    branch_col = (f"{ELECTRIC}{ICON_BRANCH} {branch}{RESET}"
                  if branch else f"{DIM_PURP}{ICON_BRANCH} ?{RESET}")

    line1 = (
        f"{BOLD}{NEON_PINK}{ICON_MODEL} {model}{RESET}{sep}"
        f"{branch_col}{sep}"
        f"{VIOLET}{ICON_INPUT}{fmt_k(max(context_length, cur_k * 1000))}{RESET} "
        f"{context_bar(ctx_pct)} {DIM_PURP}{prefix}{cur_k}k/{max_k}k{RESET}"
    )

    lines = [line1]
    st = st_line(cwd)
    if st:
        lines.append(st)

    print(build_table(lines))


if __name__ == '__main__':
    main()
