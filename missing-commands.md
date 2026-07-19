# Logo Corpus Command Inventory

Analysis of `logo-corpus.txt` against `logo3d.js`.  
Corpus: ~155 programs separated by `///`.  
User-defined procedure names, colon-variables, numbers, brackets, and `#hex` colors are excluded throughout.

---

## 1. User-Defined Procedure Names (Excluded from Analysis)

These names appear after `TO` in the corpus. They are not built-in commands and are excluded from the MISSING bucket.

`A` `A1` `A2` `A3` `A4` `ALL` `ARM` `ARC` `AY` `B` `BA` `BEND` `BT` `BU` `BX`  
`C` `CN` `COLOR` `CR` `CU` `CUU` `D` `DA` `DB` `DD` `E` `F` `FIN` `G` `GG`  
`GP` `H` `HB` `J` `JL` `K` `L` `L2` `LN` `M` `MANY` `N` `N2` `NANO` `NORM`  
`O` `PL` `PLC` `POLY` `R` `R2` `R4` `ROW` `RN` `RW` `S` `SAM` `SH` `SL`  
`SMALL` `SM`† `SPIRAL` `SQ` `SS` `ST` `T` `TINY` `TL` `TS` `U` `V` `W`  
`WAS` `WING` `X` `XX` `XY` `Y` `YY` `Z`  
Plus numeric-name procedures: `1` `1L` `2` `2M` `3` `3L` `3S` `4` `5` `6` `6L` `7` `8` `9` `9L` `10` `11` `16` `18` `24` `32` `36` `40` `64` `128` `256`

†`SM` is also called in 2 programs that don't define it (they rely on `import libshapes`) — flagged separately below.

---

## 2. Complete Token Inventory

### 2a. IMPLEMENTED

All of these are recognised and executed by `logo3d.js`.

| Token | Programs Using It | Notes |
|---|---|---|
| FD | 200+ | Forward |
| LT | 200+ | Left turn; also used as IF comparison keyword |
| RT | 200+ | Right turn |
| MAKE | 200+ | Variable assignment |
| RPT | 200+ | Repeat |
| OMARK | 200+ | Save turtle state to named mark |
| GOTO | 200+ | Restore turtle state from mark |
| TO | 200+ | Define procedure |
| END | 200+ | Close procedure definition |
| IF | 150+ | Conditional |
| PU | 150+ | Pen up |
| PD | 150+ | Pen down |
| SC | 150+ | Set color (also `SETCOLOR`) |
| CENTER | 150+ | Reset turtle + camera pan |
| UP | 100+ | Pitch up |
| DN | 100+ | Pitch down |
| AR | 100+ | Arc right (yaw plane) |
| AL | 100+ | Arc left (yaw plane) |
| AU | 80+ | Arc up (pitch plane) |
| ELSE | 50+ | Else clause for IF |
| SP | 50+ | Snap to nearest segment |
| AD | 50+ | Arc down (pitch plane) |
| RED | 60 | Named color |
| ORANGE | 50 | Named color |
| YELLOW | 40 | Named color |
| GREEN | 40 | Named color |
| BLUE | 40 | Named color |
| PURPLE | 30 | Named color |
| MAGENTA | 25 | Named color |
| PICK | 30 | Pick random item from list |
| RANDOM | 30 | Random integer 0..N-1 |
| SLY | 25 | Speed hint (no-op in batch) |
| RL | 20 | Roll left |
| RR | 20 | Roll right |
| WIDTH | 10 | Set line width |
| WHITE | 10 | Named color |
| RC | 8 | Random color |
| PAUSE | 8 | Pause (no-op in browser) |
| BK | 3 | Move backward |
| HOME | 3 | Alias for CENTER |
| STOP | 6 | Exit current procedure |
| CLEAR | 5 | Clear screen |
| REPEAT | 5 | Alias for RPT |
| ARCRIGHT | 4 | Long-form alias for AR |
| ARCLEFT | 1 | Long-form alias for AL |
| ARCUP | 1 | Long-form alias for AU |
| ARCDOWN | 1 | Long-form alias for AD |
| SETCOLOR | 3 | Alias for SC |
| BLACK | 5 | Named color |
| CYAN | 2 | Named color |
| PINK | 1 | Named color |
| GRAY | 1 | Named color |
| GC | 1 | Get current color (resolveAny) |
| GETCOLOR | 1 | Alias for GC |
| CS | 1 | Alias for CLEAR |
| IMPORT | 3 | Silently ignored (library stubs) |

**Total IMPLEMENTED: 55 tokens**

---

### 2b. MISSING

Commands that appear in the corpus, are not user-defined procedures in those programs, and are not currently implemented in `logo3d.js`.

#### Control Flow / Conditions

| Token | Programs | Usage Pattern | Notes |
|---|---|---|---|
| GT | 14 | `if cc gt 5`, `if b gt 90` | Greater-than comparison in IF. `evalCondition` handles the 3-token form `VAR GT NUM` — but `GT` as a standalone comparison op is only partially working per CLAUDE.md. Verify it works end-to-end. |

#### Color

| Token | Programs | Usage Pattern | Notes |
|---|---|---|---|
| TEAL | 1 | `sc pick [teal [45 00 99] purple gold]` | Named color — add to `colorFromValue()` |
| GOLD | 1 | same line as TEAL | Named color — add to `colorFromValue()` |
| SBGC | 1 | `sbgc white sc black` | Set **background** color. Takes a color argument. The canvas background is hardcoded `#0b0f14` in `draw()`. |

#### Library Procedures (via `import libshapes`)

| Token | Programs | Usage Pattern | Notes |
|---|---|---|---|
| SM | 2 | `sm 40` after `import libshapes` | Procedure from the (ignored) `libshapes` library. Programs that call it will throw "Unknown procedure: SM". Known limitation. |

#### Likely Typos (single occurrence each — low priority)

| Token | Programs | Usage Pattern | Notes |
|---|---|---|---|
| GOT | 1 | `if c got 9` | Typo of `GT`. Will fall through to the unrecognised-form default (currently returns `true`). |
| CENTERS | 1 | `centers` (bare, no arg) | Apparent typo of `CENTER`. Will throw "Unknown procedure: CENTERS". |
| CENTERK | 1 | `centerk` (bare, no arg) | Same — typo of `CENTER`. |

**Total MISSING: 8 tokens** (GT, TEAL, GOLD, SBGC, SM, GOT, CENTERS, CENTERK)  
Excluding the 3 typos, **5 meaningful missing features**.

---

### 2c. POSSIBLE ALIASES

Tokens that are close to an existing command — decide whether to add as an alias.

| Corpus Token | Closest Implemented | Programs | Recommendation |
|---|---|---|---|
| MARK | OMARK | 1 | `mark m` appears in one program. OMARK is the canonical form. Adding MARK as an alias is trivial — same one-arg op, same handler. |
| GT | LT (comparison direction) | 14 | GT is already partially in `evalCondition`. The question is whether it works reliably. Worth a verification pass rather than a new alias. |
| SBGC | (no equivalent) | 1 | Would need new logic: expose background color as a settable state and call `draw()` to repaint. Not a rename — a new feature. |

---

## 3. MISSING Grouped by Category

### Movement / Turtle State
*(none missing)*

### Control Flow / Conditions
- **GT** (14 programs) — greater-than comparison inside IF. Already partially implemented in `evalCondition`; needs verification that it's working end-to-end in the corpus programs.

### Color
- **TEAL** (1 program) — add to `colorFromValue()` named-color table
- **GOLD** (1 program) — same; suggest `#FFD700`
- **SBGC** (1 program) — set background color; requires new state + `draw()` integration

### Drawing / Geometry
*(none missing)*

### Library Calls (will always fail without library implementation)
- **SM** (2 programs) — from `libshapes`; can be stubbed or ignored

### Typos (won't fix — they're broken programs, not missing commands)
- GOT → GT (line ~7500)
- CENTERS → CENTER (line ~1893)
- CENTERK → CENTER (line ~2125)

---

## 4. Priority Ranking

| Priority | Item | Effort | Impact |
|---|---|---|---|
| 1 | Verify GT works in IF conditions | Low — already in code | 14 programs |
| 2 | TEAL + GOLD named colors | Trivial — 2 lines in `colorFromValue()` | 1 program each |
| 3 | MARK as alias for OMARK | Trivial — add to `oneArgOps` list | 1 program |
| 4 | SBGC (set background color) | Medium — new state + draw() hook | 1 program |
| 5 | SM / libshapes | High — entire library to implement | 2 programs |

---

## 5. Notes on Mixed-Case Programs

The last section of the corpus (starting around line 7280, labeled "LOGO CODE main") uses Title Case: `Make`, `To`, `Rpt`, `Fd`, `Sc`, `Omark`, `If`, `Center`. The tokenizer uppercases all non-hex tokens, so this should work correctly already.

## 6. Numeric Procedure Names

Several programs define procedures with numeric names (`to 3s`, `to 256`, etc.) and call them bare. These parse correctly through the fallback CALL handler. The interpreter will look them up in `procs` at runtime — they'll work as long as they're defined before being called.
