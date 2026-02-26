---
"aspectcode": patch
"@aspectcode/emitters": patch
"@aspectcode/evaluator": patch
---

Dashboard UX, probe fixes, KB-custom generation, and run-mode resolution

**Dashboard & CLI polish**
- Summary card, first-run onboarding, diff preview, token counts, `--compact` flag
- Collapsed reasoning display to single line; hid trivial messages
- Replaced specific emoji with ASCII alternatives in dashboard
- Removed redundant "API key: openai" line (provider already shown in stats)
- Removed auto-creation of `aspectcode.json`
- Fixed banner top-line clipping in VS Code terminal
- Renamed "complaint" terminology to neutral "refining" / "pending" / "changes applied"
- Removed hint lines from dashboard

**Evaluator probe fixes**
- Fixed `parseHubs` to handle both 3-col and 5-col hub tables (real emitter format)
- Fixed `parseEntryPoints` to handle bullet-list format in addition to tables
- Fixed `parseConventions` to handle sub-sections, `**Use:**` directives, and tables
- Fixed `extractSubSection` to be emoji-tolerant and heading-level-aware
- Dashboard hides "0/0 probes passed" when no probes are found

**KB-custom generation (no API key)**
- New `generateKbCustomContent()` embeds project-specific KB facts (hubs, entry points, conventions, integrations, layout) directly into AGENTS.md
- Without an API key, produces a useful project-specific file instead of a generic template

**Run-mode resolution**
- Smart run-mode: when AGENTS.md already exists, skip regeneration and just watch
- When AGENTS.md has section markers, auto-continue in section mode
- 2-option prompt (full vs section) only shown on first run when no AGENTS.md exists
- Watch-mode always generates on subsequent file-change-triggered runs

**README**
- Rewrote root README.md; trimmed stale content, corrected flow description
- Added `packages/cli/README.md` for npm landing page

