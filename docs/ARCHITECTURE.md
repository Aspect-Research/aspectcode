# Architecture

> Extension-specific layering rules, file size limits, and conventions.
> For the full system architecture (all packages), see
> [SYSTEM-ARCHITECTURE.md](SYSTEM-ARCHITECTURE.md).

## Current State

Aspect Code is a multi-package TypeScript monorepo. Pure analysis and
generation logic lives in `packages/core` and `packages/emitters`. The
optimizer (`packages/optimizer`) handles LLM-based AGENTS.md improvement.
The CLI (`packages/cli`) orchestrates the full pipeline. The VS Code
extension (`extension/`) is an ultra-thin launcher that spawns the CLI
as a subprocess.

The extension contains a single source file:

```
extension/src/
└── extension.ts    — VS Code activate/deactivate, CLI subprocess management
```

It resolvesCLI binary location, spawns `aspectcode` as a long-running
child process (watch mode), and exposes Start/Stop commands in the
Command Palette.

## Current Architecture (multi-package)

```
┌──────────────────────────────────────────────────┐
│  extension/  (VS Code thin launcher)             │
│  Start/Stop commands, status bar, CLI subprocess  │──▶ aspectcode (subprocess)
├──────────────────────────────────────────────────┤
│  packages/cli/  (aspectcode)                     │
│  Single command: analyze → emit → optimize →     │──▶ @aspectcode/core
│  watch. No subcommands.                          │──▶ @aspectcode/emitters
│                                                  │──▶ @aspectcode/optimizer
├──────────────────────────────────────────────────┤
│  packages/optimizer/  (@aspectcode/optimizer)    │
│  LLM evaluate → improve → accept loop           │──▶ (LLM APIs)
├──────────────────────────────────────────────────┤
│  packages/emitters/  (@aspectcode/emitters)      │
│  KB emitter, instructions emitter, manifest,     │──▶ @aspectcode/core
│  transactions, report                            │
├──────────────────────────────────────────────────┤
│  packages/core/  (@aspectcode/core)              │
│  analyzeRepo, analyzeRepoWithDependencies,       │   (zero external deps)
│  discoverFiles, DependencyAnalyzer, parsers      │
└──────────────────────────────────────────────────┘
```

Packages:
- **`@aspectcode/core`** — `analyzeRepo()`, `analyzeRepoWithDependencies()`, `discoverFiles()`, `DependencyAnalyzer`, tree-sitter grammars
- **`@aspectcode/emitters`** — `runEmitters()`, KB emitter, instructions emitter, manifest, transactions
- **`@aspectcode/optimizer`** — LLM agentic loop for AGENTS.md quality improvement
- **`aspectcode`** — Single command `aspectcode [flags]` with pipeline architecture

## Layering Rules (enforced in CI)

These rules are checked by `npm run check:boundaries`:

1. **No file** may import from `dist/`.
2. **Test files** are exempt from boundary rules.

### Cross-package Rules (enforced structurally)

- `packages/core/` has no `vscode` dependency — cannot import it.
- `packages/emitters/` depends only on `core` — no `vscode`.
- `packages/optimizer/` depends on `core` + `emitters` — no `vscode`.
- `packages/cli/` depends on `core` + `emitters` + `optimizer` — no `vscode`.
- `extension/` spawns the CLI as a subprocess. No direct package imports.

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files | PascalCase for classes, camelCase for modules | `DependencyAnalyzer.ts`, `pipeline.ts` |
| Classes | PascalCase | `DependencyAnalyzer` |
| Interfaces/Types | PascalCase, no `I` prefix | `DependencyLink` |
| Functions | camelCase | `analyzeRepo()` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_MAX_LINES` |
| Test files | `*.test.ts` | `snapshot.test.ts` |

## File Size Limits

Enforced by `npm run check:filesize`:

- **New files:** 400 lines max.
- **Grandfathered files:** capped at their current size (rounded up).
  Every refactor PR should reduce the grandfathered cap.

## Where New Code Should Go

| You're adding… | Put it in… |
|----------------|-----------|
| Pure analysis logic (no vscode) | `packages/core/src/` |
| Artifact generation / content builders | `packages/emitters/src/` |
| LLM optimization logic | `packages/optimizer/src/` |
| CLI pipeline changes | `packages/cli/src/` |
| Extension lifecycle / commands | `extension/src/extension.ts` |
| Shared TypeScript types | `packages/core/src/` |

## Testing

All tests run offline. No network access required.

| Package | Runner | Notes |
|---------|--------|-------|
| `@aspectcode/core` | mocha + ts-node | Snapshot tests against fixture repo |
| `@aspectcode/emitters` | mocha + ts-node | KB, instructions, manifest, transaction |
| `@aspectcode/optimizer` | mocha + ts-node | Agent, prompt, provider |
| `aspectcode` | mocha + ts-node | parseArgs, config, generate, settings, watch |

Run all: `npm test --workspaces`

### Fixture repo

`extension/test/fixtures/mini-repo/` contains a small, deterministic
project (4 TS files + 1 Python file) used for snapshot testing. Do not
modify it casually — changes will require updating the expected snapshot.

### Snapshot tests

`packages/core/test/snapshot.test.ts` runs `analyzeRepo()` against the
fixture repo and compares the JSON output to a committed snapshot at
`packages/core/test/fixtures/mini-repo-expected.json`.

- **To run:** `cd packages/core && npm test`
- **To update the snapshot after intentional model changes:**
  delete the expected JSON and re-run, or pass `--update`.

## How to Add a Feature (checklist)

1. Open an issue describing the feature.
2. Create a branch from `main`.
3. Write the implementation. Keep each new file under 400 lines.
4. Add or update tests.
5. Run `npm run check:all` locally (in `extension/`) — fix any failures.
6. Open a PR. CI will run lint, typecheck, format, size, and boundary checks.
7. Get a review and merge.
