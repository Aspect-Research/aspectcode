# Architecture

> This document describes the current architecture of Aspect Code and the
> target direction for the codebase. It is the source-of-truth for layering
> rules, naming conventions, and "where does new code go?" decisions.

## Current State

Aspect Code is a **VS Code extension** that generates a project-local
knowledge base (`.aspect/` directory) containing `architecture.md`, `map.md`,
`context.md`, and AI-assistant instruction files.

All runtime code lives under `extension/src/`:

```
extension/src/
├── extension.ts            – VS Code activate/deactivate, wiring
├── commandHandlers.ts      – Command palette handlers
├── state.ts                – Shared mutable state (AspectCodeState)
├── tsParser.ts             – Tree-sitter grammar loading
├── importExtractors.ts     – Language-specific import extraction
├── newCommandsIntegration.ts
├── assistants/
│   ├── kb.ts               – Knowledge-base generation (architecture, map, context)
│   ├── instructions.ts     – AI-assistant instruction file generation
│   └── detection.ts        – Detect installed AI assistants
├── panel/
│   └── PanelProvider.ts    – Webview panel (graph, UI, message handling)
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

| Issue | Severity |
|-------|----------|
| `PanelProvider.ts` is 5,300+ LOC with inline HTML, CSS, JS, graph layout, and message handling | Critical |
| `kb.ts` is 4,000+ LOC mixing file analysis, markdown generation, and template logic | Critical |
| Every file imports `vscode` — no pure-logic layer exists | High |
| `state.ts` is a mutable singleton bag; hard to test | Medium |
| No barrel files or module boundary contracts | Low |

## Target Direction

The long-term goal is a three-layer architecture:

```
┌─────────────────────────────────┐
│  extension/  (thin VS Code      │
│  adapter: commands, lifecycle,   │
│  webview host)                   │
├─────────────────────────────────┤
│  packages/core/  (pure TS:      │
│  analysis, KB gen, templates —  │
│  NO vscode import)              │
├─────────────────────────────────┤
│  cli/  (optional Node CLI       │
│  consuming @aspectcode/core)    │
└─────────────────────────────────┘
```

`packages/core/` now exists as a skeleton (`@aspectcode/core`). It defines
the `RepoModel` type and a stub `analyzeRepo()` function. Code will be
moved here incrementally from `extension/src/services/` and
`extension/src/assistants/` in later phases.

**Phase 0 does NOT do the extraction.** It installs guardrails so that
future extraction is safe and incremental.

## Layering Rules (enforced in CI)

These rules are checked by `npm run check:boundaries`:

1. **`services/`** is the lowest layer in the current structure.
   - `services/` must NOT import from `panel/`, `assistants/`,
     `commandHandlers`, or `extension.ts`.
   - `services/` MAY import from other `services/` files.

2. **`assistants/`** may import from `services/` but NOT from `panel/`.

3. **`panel/`** may import from `services/` and `assistants/` (read-only
   data), but should not contain domain logic.

4. **`extension.ts`** and **`commandHandlers.ts`** are the wiring layer.
   They may import from anywhere.

5. **No file** may import from `dist/`.

6. **Test files** are exempt from boundary rules.

### Future Rule (Phase 1+)

- `packages/core/` must NOT import `vscode`. This is already enforced
  structurally (core has no vscode dependency) and will be checked in CI.
- `extension/` will import from `@aspectcode/core` instead of reaching
  into raw analysis code.

### Soft Rules (warn only, future ratchets)

These are logged as warnings by `npm run check:boundaries` but do not
fail CI yet. They will be promoted to hard rules as code moves to core:

- `panel/` should not import from `commandHandlers` or `extension.ts`
- `assistants/` should not import from `panel/`

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
| A new VS Code command handler | `commandHandlers.ts` (or a new file in a future `commands/` folder if it would exceed the size cap) |
| A new service (file I/O, workspace scanning) | `services/NewService.ts` |
| New KB generation logic | `assistants/kb.ts` (or extract a helper into `assistants/`) |
| A new assistant integration | `assistants/` |
| Webview UI changes | `panel/` — but prefer extracting HTML/CSS into separate files |
| Shared TypeScript types | `types/` |
| Pure logic with no VS Code dependency | `packages/core/src/` |

## Testing

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

This avoids arguing about markdown diffs when refactoring analysis code.
The model is a JSON-serializable `RepoModel` — the source of truth for
what the analysis produces.

## How to Add a Feature (checklist)

1. Open an issue describing the feature.
2. Create a branch from `main`.
3. Write the implementation. Keep each new file under 400 lines.
4. Add or update tests in `src/test/`.
5. Run `npm run check:all` locally — fix any failures.
6. Open a PR. CI will run lint, typecheck, format, size, and boundary checks.
7. Get a review and merge.
