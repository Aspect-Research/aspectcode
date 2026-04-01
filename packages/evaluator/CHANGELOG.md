# @aspectcode/evaluator

## 1.0.0

### Major Changes

- [#24](https://github.com/Aspect-Code-Labs/aspectcode/pull/24) [`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351) Thanks [@asashepard](https://github.com/asashepard)! - v1.0.0 — First major release.

  Dream cycle, auto-resolve, scoped rules, multi-platform support, memory map dashboard, probe-and-refine improvements, community preferences/suggestions, auto-update, 11 tree-sitter languages.

### Patch Changes

- Updated dependencies [[`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351)]:
  - @aspectcode/core@1.0.0
  - @aspectcode/optimizer@1.0.0

## 0.4.1

### Patch Changes

- [#22](https://github.com/asashepard/aspectcode/pull/22) [`4f6a76b`](https://github.com/asashepard/aspectcode/commit/4f6a76b4eee7c0665adfa1c353e9d5c33c359727) Thanks [@asashepard](https://github.com/asashepard)! - Dashboard UX, probe fixes, KB-custom generation, and run-mode resolution

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

## 0.4.0

### Patch Changes

- Updated dependencies [[`f86ecf9`](https://github.com/asashepard/aspectcode/commit/f86ecf9e020b50b723df3d00f323653fc6165c8d)]:
  - @aspectcode/optimizer@0.4.0

## 0.3.4

### Patch Changes

- [#16](https://github.com/asashepard/aspectcode/pull/16) [`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2) Thanks [@asashepard](https://github.com/asashepard)! - Add evidence-based evaluation to the optimization pipeline

  - New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
  - Optimizer now accepts evaluator feedback to self-correct instructions across iterations
  - CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
  - CI workflows updated to build and test the evaluator package in dependency order

- Updated dependencies [[`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2)]:
  - @aspectcode/optimizer@0.3.4
