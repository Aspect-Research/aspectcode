# aspectcode

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
