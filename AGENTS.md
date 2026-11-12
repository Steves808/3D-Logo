# AGENTS.md

Instructions for Codex and other AI coding agents working on this repo.

Read CLAUDE.md first — it is the shared project guide for every AI tool here
(architecture, standing rules, current status). The same rules apply to you:

- All logic stays in logo3d.js (CSP: no inline scripts in the HTML).
- No external dependencies; must run offline by opening index.html.
- Help / Acknowledgements / Examples text is loaded at runtime from
  commands.txt, acknowledge.txt, examples.txt — never hardcode it.
- Toolbar controls use the shared `.toolbar-btn` CSS class.
- index.html and logo3d.html must stay identical.

Workflow: work on a branch, open a pull request, and describe what you changed
and how you tested it. Steve reviews and merges; Claude and Codex may review
each other's pull requests.
