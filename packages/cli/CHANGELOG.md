# aspectcode

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

- Updated dependencies [[`4f6a76b`](https://github.com/asashepard/aspectcode/commit/4f6a76b4eee7c0665adfa1c353e9d5c33c359727)]:
  - @aspectcode/emitters@0.4.1
  - @aspectcode/evaluator@0.4.1

## 0.4.0

### Minor Changes

- [#20](https://github.com/asashepard/aspectcode/pull/20) [`f86ecf9`](https://github.com/asashepard/aspectcode/commit/f86ecf9e020b50b723df3d00f323653fc6165c8d) Thanks [@asashepard](https://github.com/asashepard)! - Dashboard UX improvements: summary card showing sections/rules/file coverage after generation, token usage display, first-run onboarding message, diff summary on regeneration, and `--compact` flag to hide banner and reasoning. Reasoning display collapsed to a single short line. Added `chatWithUsage` to LLM providers for token counting.

### Patch Changes

- Updated dependencies [[`f86ecf9`](https://github.com/asashepard/aspectcode/commit/f86ecf9e020b50b723df3d00f323653fc6165c8d)]:
  - @aspectcode/optimizer@0.4.0
  - @aspectcode/evaluator@0.4.0

## 0.3.5

### Patch Changes

- [#18](https://github.com/asashepard/aspectcode/pull/18) [`2f4fbf3`](https://github.com/asashepard/aspectcode/commit/2f4fbf3974c050811dbfb6accd4c72f8c02088fe) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install crash: `Cannot find module '@aspectcode/evaluator'`

  - **Root cause:** The prepack script that materialises workspace packages for `npm pack` had a hardcoded list missing `@aspectcode/evaluator`, so it was never included in the published tarball.
  - **Fix:** `prepack.mjs` now derives the package list from `bundledDependencies` in `package.json` (single source of truth) and validates each materialised package has `package.json` and `dist/` before packing.
  - **CI guard:** New `check:bundled` script scans all runtime `@aspectcode/*` imports in CLI source and fails if any are missing from `bundledDependencies`. Wired into the `test:ci:cli-emitters` pipeline.
  - **Theme:** Updated CLI brand color from purple to orange (`#f9731c`).
  - **Docs:** Updated README, CONTRIBUTING, ARCHITECTURE, SYSTEM-ARCHITECTURE, and CHANGELOG to reflect the evaluator package, new CI checks, and corrected dependency graph.

## 0.3.4

### Patch Changes

- [#16](https://github.com/asashepard/aspectcode/pull/16) [`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2) Thanks [@asashepard](https://github.com/asashepard)! - Add evidence-based evaluation to the optimization pipeline

  - New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
  - Optimizer now accepts evaluator feedback to self-correct instructions across iterations
  - CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
  - CI workflows updated to build and test the evaluator package in dependency order
  - Fix: `@aspectcode/evaluator` was missing from CLI prepack materialisation, causing `Cannot find module '@aspectcode/evaluator'` after global install. The prepack script now derives its package list from `bundledDependencies` in `package.json` (single source of truth) and validates each materialised package before packing.
  - New CI check (`check:bundled`): scans CLI source imports and verifies all runtime `@aspectcode/*` dependencies are listed in `bundledDependencies`, preventing this class of packaging bug in the future.

- Updated dependencies [[`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2)]:
  - @aspectcode/evaluator@0.3.4
  - @aspectcode/optimizer@0.3.4
  - @aspectcode/emitters@0.3.4

## 0.3.3

### Patch Changes

- [#14](https://github.com/asashepard/aspectcode/pull/14) [`2d27fc9`](https://github.com/asashepard/aspectcode/commit/2d27fc97653760d10a873052badbe57a9bb8f3a2) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI hanging on startup when AGENTS.md exists

  Move the ownership prompt (selectPrompt) to run before the Ink dashboard mounts, preventing a stdin deadlock between Ink's useInput and the raw-mode readline prompt.

## 0.3.2

### Patch Changes

- [#12](https://github.com/asashepard/aspectcode/pull/12) [`4c170b8`](https://github.com/asashepard/aspectcode/commit/4c170b85ebb5080070a49a7fcb3dbf9836508526) Thanks [@asashepard](https://github.com/asashepard)! - Improve CLI experience with React-based dashboard and better output

  - Add interactive React CLI dashboard using Ink for real-time status updates
  - Add complaint processor for structured error handling and reporting
  - Condense and improve continuous mode status output
  - Update optimizer agent with expanded prompts and streaming support

- Updated dependencies [[`4c170b8`](https://github.com/asashepard/aspectcode/commit/4c170b85ebb5080070a49a7fcb3dbf9836508526)]:
  - @aspectcode/optimizer@0.3.2

## 0.3.1

### Patch Changes

- [#10](https://github.com/asashepard/aspectcode/pull/10) [`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)

- Updated dependencies [[`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52)]:
  - @aspectcode/core@0.3.1
  - @aspectcode/emitters@0.3.1
  - @aspectcode/optimizer@0.3.1

## 0.3.0

### Minor Changes

- [#8](https://github.com/asashepard/aspectcode/pull/8) [`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd) Thanks [@asashepard](https://github.com/asashepard)! - Fix CI build order: optimizer now builds before CLI across all workflows and scripts

### Patch Changes

- Updated dependencies [[`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd)]:
  - @aspectcode/optimizer@0.3.0
  - @aspectcode/core@0.3.0
  - @aspectcode/emitters@0.3.0

## 0.2.2

### Patch Changes

- [#5](https://github.com/asashepard/aspectcode/pull/5) [`be18f1d`](https://github.com/asashepard/aspectcode/commit/be18f1dfd7b2dc640396e1557145bd67e04ab94a) Thanks [@asashepard](https://github.com/asashepard)! - Simplify to AGENTS.md-only output; trim CLI surface

  **AGENTS.md only:** Removed all multi-assistant generation infrastructure. The
  CLI and extension now produce a single `AGENTS.md` instruction file
  unconditionally — there are no assistant-selection flags, no quickpick UI, and
  no per-assistant content generators. Previously separate output files
  (`.github/copilot-instructions.md`, `.cursor/rules/aspectcode.mdc`, `CLAUDE.md`)
  are no longer produced.

  **Extension simplification:** The extension's `kb.ts` is now the single
  assistant module — all multi-assistant detection, configuration, and content
  generation code was removed. The `configureAssistants` command, assistant
  quickpick UI, and `detection.ts` module are gone. `kbShared.ts` provides the
  shared `buildRelativeFileContentMap` helper.

  **CLI trim-down:**

  - **Removed `init` command** — settings commands auto-create `aspectcode.json` when needed.
  - **Removed `outDir` persistence** — `set-out-dir` / `clear-out-dir` commands deleted; `outDir` config key removed. Use `--out` flag at runtime instead.
  - **Consolidated `impact` → `deps impact`** — impact analysis is now a subcommand of `deps` alongside `deps list`.

  ### What changed

  **Removed CLI flags:** `--copilot`, `--cursor`, `--claude`, `--other`, `--force` / `-f`
  **Removed CLI commands:** `init`, `impact` (standalone), `set-out-dir`, `clear-out-dir`
  **Removed extension command:** `aspectcode.configureAssistants`
  **Removed types:** `AssistantFlags`, `AssistantsSettings`, `AssistantsOverride`
  **Removed config key:** `outDir`
  **Removed functions:** `getAssistantsSettings()`, `handleConfigureAssistants()`,
  `generateCopilotContent()`, `generateCursorContent()`, `generateClaudeContent()`,
  `detectAssistants()`, `runInit()`, `runSetOutDir()`, `runClearOutDir()`,
  `printAspectCodeBanner()`
  **Removed files:** `extension/src/assistants/detection.ts`,
  `extension/src/assistants/instructions.ts`,
  `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/impact.ts`,
  `packages/cli/test/init.test.ts`
  **Removed output files:** `.github/copilot-instructions.md`,
  `.cursor/rules/aspectcode.mdc`, `CLAUDE.md`
  **Consolidated:** `runImpact()` → `runDepsImpact()` (now in `deps.ts`)

  ### CLI commands (current state)

  ```
  aspectcode <command> [options]
  ```

  #### Commands

  | Command                  | Aliases    | Description                                     |
  | ------------------------ | ---------- | ----------------------------------------------- |
  | `generate`               | `gen`, `g` | Discover, analyze, and emit KB + AGENTS.md      |
  | `watch`                  |            | Watch source files and regenerate on changes    |
  | `deps list`              |            | List dependency connections                     |
  | `deps impact`            |            | Compute dependency impact for a single file     |
  | `show-config`            |            | Print current `aspectcode.json` values          |
  | `set-update-rate <mode>` |            | Set updateRate (`manual` / `onChange` / `idle`) |
  | `add-exclude <path>`     |            | Add a path to the exclude list                  |
  | `remove-exclude <path>`  |            | Remove a path from the exclude list             |

  #### Global flags

  | Flag            | Short | Description                   |
  | --------------- | ----- | ----------------------------- |
  | `--help`        | `-h`  | Show help text                |
  | `--version`     | `-V`  | Print version                 |
  | `--verbose`     | `-v`  | Show debug output             |
  | `--quiet`       | `-q`  | Suppress non-error output     |
  | `--root <path>` | `-r`  | Workspace root (default: cwd) |
  | `--json`        |       | Machine-readable JSON output  |
  | `--no-color`    |       | Disable ANSI color output     |

  #### `generate` flags

  | Flag                         | Short | Description                             |
  | ---------------------------- | ----- | --------------------------------------- |
  | `--out <path>`               | `-o`  | Output directory override               |
  | `--kb`                       |       | Generate `kb.md` knowledge base file    |
  | `--kb-only`                  |       | Generate KB only, skip AGENTS.md        |
  | `--instructions-mode <mode>` |       | `safe` (default) / `permissive` / `off` |
  | `--list-connections`         |       | Print dependency connections            |
  | `--file <path>`              |       | Filter connections to one file          |

  #### `watch` flags

  | Flag            | Description                                |
  | --------------- | ------------------------------------------ |
  | `--mode <mode>` | Watch mode: `manual` / `onChange` / `idle` |

  #### `deps impact` flags

  | Flag            | Description                  |
  | --------------- | ---------------------------- |
  | `--file <path>` | Target file (required)       |
  | `--json`        | Machine-readable JSON output |

  #### `deps list` flags

  | Flag                 | Description                    |
  | -------------------- | ------------------------------ |
  | `--file <path>`      | Filter connections to one file |
  | `--list-connections` | Include connection details     |

  #### Output files

  | File        | When produced                                             |
  | ----------- | --------------------------------------------------------- |
  | `AGENTS.md` | Always (unless `--kb-only` or `--instructions-mode off`)  |
  | `kb.md`     | When `--kb`, `--kb-only`, or `generateKb: true` in config |

  #### Examples

  ```sh
  aspectcode generate
  aspectcode generate --kb
  aspectcode g --json
  aspectcode generate --kb-only
  aspectcode generate --instructions-mode permissive
  aspectcode generate --list-connections --file src/app.ts
  aspectcode deps impact --file src/app.ts
  aspectcode deps list --file src/app.ts
  aspectcode watch --mode idle
  aspectcode show-config --json
  aspectcode set-update-rate onChange
  aspectcode add-exclude vendor
  aspectcode remove-exclude vendor
  ```

## 0.2.1

### Patch Changes

- [#3](https://github.com/asashepard/aspectcode/pull/3) [`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d) Thanks [@asashepard](https://github.com/asashepard)! - Fix release pipeline: mark extension as private to prevent accidental npm publish, add VSIX build and GitHub Release attachment to CI/CD.

- Updated dependencies [[`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d)]:
  - @aspectcode/core@0.2.1
  - @aspectcode/emitters@0.2.1

## 0.2.0

### Minor Changes

- [#1](https://github.com/asashepard/aspectcode/pull/1) [`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476) Thanks [@asashepard](https://github.com/asashepard)! - Prepare packages for npm publishing. Bundle tree-sitter WASM parsers into
  @aspectcode/core so the CLI works after global install. Add publishConfig
  to CLI. Bump all packages to 0.1.0.

### Patch Changes

- Updated dependencies [[`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476)]:
  - @aspectcode/core@0.2.0
  - @aspectcode/emitters@0.2.0
