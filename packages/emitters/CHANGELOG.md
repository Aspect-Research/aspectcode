# @aspectcode/emitters

## 1.0.0

### Major Changes

- [#24](https://github.com/Aspect-Code-Labs/aspectcode/pull/24) [`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351) Thanks [@asashepard](https://github.com/asashepard)! - v1.0.0 — First major release.

  Dream cycle, auto-resolve, scoped rules, multi-platform support, memory map dashboard, probe-and-refine improvements, community preferences/suggestions, auto-update, 11 tree-sitter languages.

### Patch Changes

- Updated dependencies [[`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351)]:
  - @aspectcode/core@1.0.0

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

## 0.3.4

### Patch Changes

- [#16](https://github.com/asashepard/aspectcode/pull/16) [`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2) Thanks [@asashepard](https://github.com/asashepard)! - Add evidence-based evaluation to the optimization pipeline

  - New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
  - Optimizer now accepts evaluator feedback to self-correct instructions across iterations
  - CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
  - CI workflows updated to build and test the evaluator package in dependency order

## 0.3.1

### Patch Changes

- [#10](https://github.com/asashepard/aspectcode/pull/10) [`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)

- Updated dependencies [[`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52)]:
  - @aspectcode/core@0.3.1

## 0.3.0

### Minor Changes

- [#8](https://github.com/asashepard/aspectcode/pull/8) [`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd) Thanks [@asashepard](https://github.com/asashepard)! - Fix CI build order: optimizer now builds before CLI across all workflows and scripts

### Patch Changes

- Updated dependencies [[`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd)]:
  - @aspectcode/core@0.3.0

## 0.2.1

### Patch Changes

- [#3](https://github.com/asashepard/aspectcode/pull/3) [`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d) Thanks [@asashepard](https://github.com/asashepard)! - Fix release pipeline: mark extension as private to prevent accidental npm publish, add VSIX build and GitHub Release attachment to CI/CD.

- Updated dependencies [[`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d)]:
  - @aspectcode/core@0.2.1

## 0.2.0

### Minor Changes

- [#1](https://github.com/asashepard/aspectcode/pull/1) [`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476) Thanks [@asashepard](https://github.com/asashepard)! - Prepare packages for npm publishing. Bundle tree-sitter WASM parsers into
  @aspectcode/core so the CLI works after global install. Add publishConfig
  to CLI. Bump all packages to 0.1.0.

### Patch Changes

- Updated dependencies [[`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476)]:
  - @aspectcode/core@0.2.0
