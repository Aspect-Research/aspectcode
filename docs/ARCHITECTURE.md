# Architecture

> Extension-specific layering rules, file size limits, and conventions.
> For the full system architecture (all packages), see
> [SYSTEM-ARCHITECTURE.md](SYSTEM-ARCHITECTURE.md).

## Current State

Aspect Code is a multi-package TypeScript monorepo. Pure analysis and
generation logic lives in `packages/core` and `packages/emitters`. The
CLI (`packages/cli`) and VS Code extension (`extension/`) consume them.

The extension still contains legacy code (large files, inline UI) that
is being incrementally extracted. This document covers the **extension**
layering rules. Extension-specific code lives under `extension/src/`:

```
extension/src/
├── extension.ts            – VS Code activate/deactivate, wiring
├── commandHandlers.ts      – Command palette handlers
├── state.ts                – Shared mutable state (AspectCodeState)
├── tsParser.ts             – Tree-sitter grammar loading
├── importExtractors.ts     – Language-specific import extraction
├── assistants/
│   ├── kb.ts               – Knowledge-base generation (architecture, map, context)
│   ├── instructions.ts     – AI-assistant instruction file generation
│   └── detection.ts        – Detect installed AI assistants
├── services/
│   ├── DependencyAnalyzer.ts
│   ├── FileDiscoveryService.ts
│   ├── WorkspaceFingerprint.ts
│   ├── aspectSettings.ts
│   ├── DirectoryExclusion.ts
│   ├── gitignoreService.ts
│   └── enablementCancellation.ts
├── test/
│   └── kb.test.ts
└── types/                  – (empty; reserved for shared type definitions)
```

### Known Issues

| Issue | Severity | Status |
|-------|----------|--------|
| `kb.ts` is 4,000+ LOC mixing analysis and generation | Critical | Partially delegated to emitters |
| `state.ts` is a mutable singleton bag; hard to test | Medium | Open |
| Legacy instruction/detection code duplicated with emitters | Low | Emitters are now canonical |

## Current Architecture (multi-package)

```
┌─────────────────────────────────┐
│  extension/  (VS Code adapter:  │──▶ @aspectcode/core
│  commands, lifecycle, watchers)  │──▶ @aspectcode/emitters
├─────────────────────────────────┤
│  packages/cli/                  │──▶ @aspectcode/core
│  (Node CLI entry point)         │──▶ @aspectcode/emitters
├─────────────────────────────────┤
│  packages/emitters/             │──▶ @aspectcode/core
│  (KB, instructions, manifest)   │
├─────────────────────────────────┤
│  packages/core/                 │   (zero external deps)
│  (analysis, discovery, stats)   │
└─────────────────────────────────┘
```

Packages that now exist and are functional:
- **`@aspectcode/core`** — `analyzeRepo()`, `discoverFiles()`, `DependencyAnalyzer`, tree-sitter grammars
- **`@aspectcode/emitters`** — `runEmitters()`, KB emitter, instructions emitter, manifest, transactions
- **`@aspectcode/cli`** — `aspectcode init`, `aspectcode generate`, `aspectcode watch`, `aspectcode deps list`

### Phase 4 Target

The extension will shell out to `aspectcode generate --json` and render
the result. The extension becomes a thin wrapper: lifecycle, commands,
status bar.

### CLI behavior baseline (must stay tested)

- `aspectcode init` writes default `aspectcode.json` (safe mode + `updateRate: onChange`).
- `aspectcode generate` writes KB/instruction artifacts.
- `aspectcode generate --json` emits machine-readable write stats + connections.
- `aspectcode generate --list-connections` prints dependency connections.
- `aspectcode generate --json --file <path>` or `--list-connections --file <path>` filters connections to one workspace file.
- `aspectcode watch` runs as a long-lived watcher and regenerates by mode (`onChange`/`idle`/`manual`).
- `aspectcode deps list` prints dependency connections without artifact generation, and supports `--file <path>` filtering.
- Legacy config compatibility is preserved (`autoRegenerateKb` mapping).

All migration work should preserve this baseline through CLI tests first.

## Layering Rules (enforced in CI)

These rules are checked by `npm run check:boundaries`:

1. **`services/`** is the lowest layer in the current structure.
  - `services/` must NOT import from `assistants/`,
     `commandHandlers`, or `extension.ts`.
   - `services/` MAY import from other `services/` files.

2. **`assistants/`** may import from `services/`.

3. **`extension.ts`** and **`commandHandlers.ts`** are the wiring layer.
   They may import from anywhere.

4. **No file** may import from `dist/`.

5. **Test files** are exempt from boundary rules.

### Cross-package Rules (enforced structurally)

- `packages/core/` has no `vscode` dependency — cannot import it.
- `packages/emitters/` depends only on `core` — no `vscode`.
- `packages/cli/` depends on `core` + `emitters` — no `vscode`.
- `extension/` imports from `@aspectcode/core` and `@aspectcode/emitters`.

### Soft Rules (warn only, future ratchets)

No soft boundary rules are currently configured.

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files | PascalCase for classes, camelCase for modules | `DependencyAnalyzer.ts`, `importExtractors.ts` |
| Classes | PascalCase | `AspectCodeState` |
| Interfaces/Types | PascalCase, no `I` prefix | `DependencyLink` |
| Functions | camelCase | `generateKnowledgeBase()` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_MAX_LINES` |
| Test files | `*.test.ts` | `kb.test.ts` |

## File Size Limits

Enforced by `npm run check:filesize`:

- **New files:** 400 lines max.
- **Grandfathered files:** capped at their current size (rounded up).
  Every refactor PR should reduce the grandfathered cap.
- The goal is for every file to be under 400 lines by the end of
  the refactor.

## Where New Code Should Go

| You're adding… | Put it in… |
|----------------|-----------|
| Pure analysis logic (no vscode) | `packages/core/src/` |
| Artifact generation / content builders | `packages/emitters/src/` |
| A new CLI command | `packages/cli/src/commands/` |
| A new VS Code command handler | `extension/src/commandHandlers.ts` |
| A new service (file I/O, workspace scanning) | `extension/src/services/` |
| Shared TypeScript types | `packages/core/src/` or `extension/src/types/` |

## Testing

All tests run offline. No network access required.

| Package | Runner | Tests | Notes |
|---------|--------|-------|-------|
| `@aspectcode/core` | mocha + ts-node | 10 | Snapshot tests against fixture repo |
| `@aspectcode/emitters` | mocha + ts-node | 78 | KB, instructions, manifest, transaction |
| `@aspectcode/cli` | mocha + ts-node | 37 | parseArgs, config compatibility, init, generate, deps |
| Extension | VS Code test harness | 1+ | `kb.test.ts` |

Run all: `npm test --workspaces`

CLI-only (preferred first step during migration):

`cd packages/cli && npm test`

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
4. Add or update tests in `src/test/`.
5. Run `npm run check:all` locally — fix any failures.
6. Open a PR. CI will run lint, typecheck, format, size, and boundary checks.
7. Get a review and merge.
