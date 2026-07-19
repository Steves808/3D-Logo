import re
from collections import defaultdict

# Read the corpus
with open("D:/Webpages/LogoX3/logo-corpus.txt", "r", encoding="utf-8") as f:
    content = f.read()

lines = content.split('\n')

programs = []
current_program_lines = []
prog_idx = 0

def is_separator(line):
    stripped = line.strip()
    if not stripped:
        return False
    return bool(re.match(r'^[/=\-\*]+\s*$', stripped))

for line in lines:
    if is_separator(line):
        if current_program_lines:
            programs.append((prog_idx, current_program_lines))
            prog_idx += 1
            current_program_lines = []
    else:
        current_program_lines.append(line)

if current_program_lines:
    programs.append((prog_idx, current_program_lines))

print(f"Total programs found: {len(programs)}")

# Collect all user-defined procedure names across all programs
all_user_proc_names = set()
for pidx, prog_lines in programs:
    for line in prog_lines:
        if line.strip().startswith(';'):
            continue
        tokens = re.findall(r'\S+', line)
        for i, tok in enumerate(tokens):
            if tok.upper() in ('TO',) and i+1 < len(tokens):
                next_tok = tokens[i+1]
                if not next_tok.startswith(':'):
                    all_user_proc_names.add(next_tok.upper())

print(f"User-defined proc names raw count: {len(all_user_proc_names)}")

BUILTINS = {
    'PU', 'PD', 'HOME', 'CENTER', 'CS', 'CLEAR', 'STOP',
    'FD', 'BK', 'LT', 'RT', 'UP', 'DN', 'RL', 'RR', 'WIDTH', 'OMARK', 'GOTO', 'PAUSE', 'SLY', 'SP',
    'AR', 'AL', 'AU', 'AD', 'ARCRIGHT', 'ARCLEFT', 'ARCUP', 'ARCDOWN',
    'REPEAT', 'RPT', 'IF', 'ELSE', 'TO', 'END', 'MAKE',
    'SC', 'SETCOLOR', 'RC', 'GC', 'GETCOLOR',
    'PICK', 'RANDOM',
    'IMPORT',
    'WHITE', 'BLACK', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'MAGENTA', 'CYAN', 'PINK', 'GRAY',
    'TEAL', 'GOLD',
}

def is_pure_number(tok):
    try:
        float(tok)
        return True
    except ValueError:
        return False

def should_exclude_token(tok):
    if tok in ('', '[', ']', ';'):
        return True
    if tok.startswith(':'):
        return True
    if tok.startswith('#'):
        return True
    if is_pure_number(tok):
        return True
    if tok.startswith('-') and len(tok) > 1 and is_pure_number(tok[1:]):
        return True
    return False

token_program_count = defaultdict(set)

for pidx, prog_lines in programs:
    for line in prog_lines:
        stripped = line.strip()
        if stripped.startswith(';'):
            continue
        if is_separator(stripped):
            continue
        code_part = line
        if ';' in code_part:
            code_part = code_part[:code_part.index(';')]

        tokens = re.findall(r'\S+', code_part)

        for tok in tokens:
            if should_exclude_token(tok):
                continue
            tok_clean = tok.rstrip('.,!?').lstrip()
            if not tok_clean:
                continue
            tok_upper = tok_clean.upper()
            if '=' in tok_clean:
                continue
            if should_exclude_token(tok_clean):
                continue
            if tok_upper and tok_upper[0].isalpha():
                token_program_count[tok_upper].add(pidx)

print(f"Total unique uppercase alpha tokens: {len(token_program_count)}")

KNOWN_ALIASES = {
    'FORWARD': 'FD',
    'FWD': 'FD',
    'BACK': 'BK',
    'BACKWARD': 'BK',
    'BACKWARDS': 'BK',
    'LEFT': 'LT',
    'RIGHT': 'RT',
    'PENUP': 'PU',
    'PENDOWN': 'PD',
    'HIDETURTLE': 'HT',
    'SHOWTURTLE': 'ST',
    'SETWIDTH': 'WIDTH',
    'COLOUR': 'SC',
    'COLOR': 'SC',
    'ARCRIGHT': 'AR',
    'ARCLEFT': 'AL',
    'ARCUP': 'AU',
    'ARCDOWN': 'AD',
    'REPEAT': 'RPT',
    'SETCOLOR': 'SC',
    'GETCOLOR': 'GC',
    'MARK': 'OMARK',
    'SBGC': 'CS (set background color - not implemented)',
    'SBGCOLOR': 'CS (set background color - not implemented)',
    'HT': 'hide turtle (not implemented)',
    'ST': 'show turtle (not implemented)',
    'SPEED': 'SLY or PAUSE',
    'WAIT': 'PAUSE',
    'SETBG': 'SBGC',
    'SETBGC': 'SBGC',
    'CENTERK': 'CENTER (typo)',
    'CENTER.': 'CENTER (typo)',
    'CENTRES': 'CENTER (typo)',
    'GT': 'comparison keyword in IF',
    'LT': 'LT (left turn) - also used as comparison',
    'GOT': 'GOTO (typo)',
    'SAM': '?',
}

def classify_token(tok):
    if tok in BUILTINS:
        return 'IMPLEMENTED', ''
    if tok in KNOWN_ALIASES:
        return 'POSSIBLE ALIAS', KNOWN_ALIASES[tok]
    if tok in all_user_proc_names:
        return 'USER-DEFINED PROC', ''
    return 'MISSING', ''

results = []
for tok, prog_set in sorted(token_program_count.items()):
    count = len(prog_set)
    cls, note = classify_token(tok)
    results.append((tok, count, cls, note))

# Print summary
impl = [r for r in results if r[2] == 'IMPLEMENTED']
missing = [r for r in results if r[2] == 'MISSING']
alias = [r for r in results if r[2] == 'POSSIBLE ALIAS']
user_def = [r for r in results if r[2] == 'USER-DEFINED PROC']

print(f"\nIMPLEMENTED: {len(impl)}")
print(f"MISSING: {len(missing)}")
print(f"POSSIBLE ALIAS: {len(alias)}")
print(f"USER-DEFINED PROC (excluded from analysis): {len(user_def)}")

print("\n\n=== ALL USER-DEFINED PROCEDURE NAMES ===")
user_proc_sorted = sorted([r[0] for r in results if r[2] == 'USER-DEFINED PROC'])
print(", ".join(user_proc_sorted))

print("\n\n=== IMPLEMENTED TOKENS ===")
impl.sort(key=lambda x: -x[1])
for tok, count, cls, note in impl:
    print(f"  {tok:20s} {count:4d} programs")

print("\n\n=== MISSING TOKENS (not user-defined procs) ===")
missing.sort(key=lambda x: -x[1])
for tok, count, cls, note in missing:
    print(f"  {tok:20s} {count:4d} programs")

print("\n\n=== POSSIBLE ALIASES ===")
alias.sort(key=lambda x: -x[1])
for tok, count, cls, note in alias:
    print(f"  {tok:20s} {count:4d} programs  -> {note}")

print("\n\n=== ALL USER-DEFINED PROC NAMES ===")
all_names = sorted(all_user_proc_names)
print(", ".join(all_names))
