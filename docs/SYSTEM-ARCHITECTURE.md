# System Architecture

> Source-of-truth for layering, package responsibilities, and data flow.
> Last updated: 2026-02-13 (CLI trimmed: init removed, impact → deps impact, outDir persistence removed).

---

## Overview

Aspect Code generates a project-local knowledge base (`kb.md`)
that helps AI coding assistants understand a codebase before making changes.
It produces a single `kb.md` file (opt-in via `--kb` flag or `generateKb` config)
and an `AGENTS.md` instruction file.

**Everything runs offline.** There are no network calls, no telemetry, no
phone-home checks. WASM grammars ship in-repo; all analysis is local.

---

## Package Map

```
aspectcode/                         ← npm workspaces root
├── packages/
│   ├── core/       @aspectcode/core      Pure analysis (no vscode)
│   ├── emitters/   @aspectcode/emitters  Artifact generation
│   └── cli/        aspectcode            CLI entry point (npm package)
├── extension/                            VS Code extension (thin adapter)
└── docs/                                 This file, guides
```

### Dependency Graph

```
  ┌────────────┐
  │  extension  │──calls──▶ aspectcode (subprocess, preferred)
  │  (VS Code)  │──uses──▶ @aspectcode/core (in-process fallback)
  │             │──uses──▶ @aspectcode/emitters (in-process fallback)
  └─────────────┘
        │
  ┌────────────┐
  │    cli      │──uses──▶ @aspectcode/core
  │  (Node.js)  │──uses──▶ @aspectcode/emitters
  └────────────┘
        │
        ▼
  ┌────────────┐     ┌────────────────┐
  │    core     │◀────│    emitters     │
  └────────────┘     └────────────────┘
```

**Rule:** `core` has zero knowledge of `emitters`, `cli`, or `extension`.
`emitters` depends on `core` only. `cli` depends on both. `extension`
prefers calling CLI as a subprocess; falls back to `core` + `emitters`
in-process when the CLI binary is unavailable.

---

## Package Details

### @aspectcode/core

Pure TypeScript. No `vscode` import, no Node-specific I/O beyond
`fs` and `path`. Target: ES2020 / CommonJS.

| Export | Purpose |
|--------|---------|
| `analyzeRepo(root, files)` | Build an `AnalysisModel` from source files (sync, regex-based) |
| `analyzeRepoWithDependencies(root, files, host)` | `analyzeRepo` + `DependencyAnalyzer` graph/hubs |
| `discoverFiles(root, opts?)` | Recursive walk → sorted absolute paths |
| `computeModelStats(model, topN)` | Summary stats from a model |
| `DependencyAnalyzer` | Full import/export/call graph builder |
| `createNodeHost(wasmDir)` | Node fs-backed `CoreHost` for tree-sitter grammars |
| `loadGrammars(host, log?)` | Initialize tree-sitter parsers from WASM |
| `toPosix(path)` | Normalize to forward slashes |

Key types: `AnalysisModel`, `AnalyzedFile`, `GraphEdge`, `HubMetric`,
`ModelStats`, `CoreHost`.

### @aspectcode/emitters

Artifact generation. Depends on `@aspectcode/core` for model types and
stats. No `vscode` import. Target: ES2020 / CommonJS.

| Export | Purpose |
|--------|---------|
| `runEmitters(model, host, opts)` | Orchestrate all emitters → `EmitReport` |
| `createNodeEmitterHost()` | Node fs-backed `EmitterHost` |
| `createKBEmitter()` | KB content builder (architecture/map/context) |
| `createInstructionsEmitter()` | AGENTS.md instruction file emitter |
| `stableStringify(value)` | Deterministic JSON (sorted keys) |
| `GenerationTransaction` | Atomic writes — temp files → rename, manifest last |

Key types: `EmitterHost`, `EmitOptions`, `EmitReport`, `Emitter`,
`InstructionsMode`.

### aspectcode (CLI)

Node.js command-line interface. Depends on both `core` and `emitters`.
No external command framework — hand-rolled argv parser.

| Command | Purpose | Output mode |
|---------|---------|-------------|
| `aspectcode generate` | Discover → analyze → emit (full pipeline) | human-readable by default, JSON with `--json`; dependency output can be scoped by `--file` |
| `aspectcode watch` | Watch files and trigger `generate` by mode | long-running process |
| `aspectcode deps list` | Compute and list dependency connections only | human-readable; supports `--file` filter |
| `aspectcode deps impact` | Compute dependency impact for a single file | human-readable by default, JSON with `--json` |
| `aspectcode show-config` | Print current `aspectcode.json` values | human-readable by default, JSON with `--json` |
| `aspectcode set-update-rate` | Set canonical `updateRate` and remove legacy key | human-readable by default, JSON with `--json` |
| `aspectcode add-exclude` / `remove-exclude` | Add or remove entries in `exclude` | human-readable by default, JSON with `--json` |

Key flags:
- Global-ish: `--root`, `--verbose`, `--quiet`, `--help`, `--version`
- `generate`: `--out`, `--list-connections`, `--json`, `--file`, `--kb-only`, `--instructions-mode`
- `deps impact`: `--file` (required), `--json`
- `deps list`: `--file` (connection filtering)
- `watch`: `--mode` (`manual|onChange|idle`)
- settings commands: positional value where required, `--json`

Config file: `aspectcode.json`.

Current config compatibility rules:
- Canonical update key: `updateRate` (`manual | onChange | idle`)
- Legacy key accepted: `autoRegenerateKb` (`off | onSave | idle`) and mapped to canonical values
- Instruction mode is safe-only (`instructionsMode: "safe"` enforced)

### extension/

VS Code extension. Thin adapter: lifecycle, commands, file watchers,
tree-sitter initialization. Delegates generation and impact
analysis to the CLI binary via subprocess (`CliAdapter.ts`), falling
back to in-process `core` + `emitters` when the CLI is unavailable.

Key service: `CliAdapter.ts` resolves the CLI binary (workspace-local →
npm resolve → PATH fallback) and spawns it with JSON output capture,
cancellation support, and timeout handling.

---

## Data Flow

### CLI Pipeline (`generate`)

```
aspectcode generate
  │
  ├─ 1. discoverFiles(root)              @aspectcode/core
  ├─ 2. fs.readFileSync each file        Node built-in
  ├─ 3. analyzeRepo(root, fileMap)        @aspectcode/core  (sync)
  └─ 4. runEmitters(model, host, opts)    @aspectcode/emitters
       ├─ KB emitter → kb.md (when --kb or generateKb: true)
       └─ Instructions emitter → AGENTS.md
```

### CLI Pipeline (`deps list`)

```
aspectcode deps list
  │
  ├─ 1. discoverFiles(root)                     @aspectcode/core
  ├─ 2. read file contents into cache           Node built-in
  ├─ 3. DependencyAnalyzer.analyzeDependencies  @aspectcode/core
  └─ 4. print normalized connection rows        CLI formatter
```

### CLI Pipeline (`watch`)

```
aspectcode watch
  │
  ├─ 1. start filesystem watchers (ignore generated/vendor paths)
  ├─ 2. apply mode timing (`onChange` debounce / `idle` timeout / `manual` no auto-run)
  ├─ 3. trigger `runGenerate(...)` on eligible events
  └─ 4. keep process alive until SIGINT/SIGTERM
```

### Extension Pipeline (current — CLI-first with fallback)

```
User action (click / save / idle)
  │
  ├─ regenerateEverything()            extension/src/assistants/kb.ts
  │   └─ generateKnowledgeBase()
  │       ├─ TRY: cliGenerate(root, ['--kb-only'])
  │       │   (spawns: aspectcode generate --json --kb-only)
  │       │   exit 0 + valid JSON → done
  │       └─ FALLBACK: generateKnowledgeBaseInProcess()
  │           ├─ analyzeRepoWithDependencies()       @aspectcode/core
  │           └─ runEmitters(model, vscodeHost)       @aspectcode/emitters
  │
  ├─ emitInstructionFilesOnlyViaEmitters()   commandHandlers.ts
  │   ├─ TRY: cliGenerateWithInstructions(root)
  │   │   (spawns: aspectcode generate --json)
  │   └─ FALLBACK: createInstructionsEmitter().emit()
  │
  └─ computeImpactSummaryForFile()     extension/src/assistants/kb.ts
      ├─ TRY: cliDepsImpact(root, relPath)
      │   (spawns: aspectcode deps impact --file <path> --json)
      └─ FALLBACK: DependencyAnalyzer in-process
```

CLI resolution order in `CliAdapter.resolveCliBin()`:
1. Workspace-local: `<root>/packages/cli/bin/aspectcode.js`
2. npm resolve: `require.resolve('aspectcode/bin/aspectcode.js')`
3. Global PATH: `aspectcode`

---

## File Outputs

| File | Source | Content |
|------|--------|---------|
| `kb.md` | KB emitter | Architecture, map, context sections (opt-in) |
| `AGENTS.md` | Instructions emitter | Agent rules (marker-wrapped) |

Instruction files use `<!-- ASPECT_CODE_START -->` / `<!-- ASPECT_CODE_END -->`
markers. User content outside the markers is preserved on regeneration.

---

## Transaction Safety

`runEmitters` uses `GenerationTransaction`:

1. Each write goes to a temp file (`.tmp-aspect-*`)
2. On commit: rename temp → final, manifest file written last
3. On error: roll back (delete temps, restore backups)

This prevents partial/corrupt output if a write fails mid-generation.

---

## Offline Guarantees

| Concern | How it's handled |
|---------|-----------------|
| Tree-sitter WASM | 7 `.wasm` files committed in `extension/parsers/` |
| NPM packages | root `package-lock.json`; `npm ci --prefer-offline` works |
| Build tools | `tsc`, `esbuild`, `mocha` — all local binaries |
| Telemetry | None. Zero network calls in any package |
| VSIX packaging | `parsers/` included via `.vscodeignore` allowlist |

---

## Testing

### Migration policy: CLI tests first

For all upcoming CLI-first migration work, implement tests before behavior changes:
1. Add/extend CLI tests that fail for the desired behavior.
2. Implement command/config changes in CLI.
3. Re-run CLI tests; only then wire extension integration.

This keeps extension changes low-risk while command behavior stabilizes.

| Package | Runner | Count | Notes |
|---------|--------|-------|-------|
| `@aspectcode/core` | mocha + ts-node | 11 | Snapshot tests against fixture repo |
| `@aspectcode/emitters` | mocha + ts-node | 79 | KB, instructions, manifest, transaction |
| `aspectcode` | mocha + ts-node | 44 | parseArgs, config, generate, deps, impact, settings, watch |
| Extension | mocha + ts-node | 10 | KB invariant + shared analysis tests |

All tests are offline. Temp directories via `os.tmpdir()`, fixed
timestamps for determinism.

Run all package tests:

```bash
npm test --workspaces
```

---

## Conventions

| Item | Rule |
|------|------|
| File size | ≤ 400 lines (CI-enforced for new files) |
| File names | PascalCase for classes, camelCase for modules |
| Types | PascalCase, no `I` prefix |
| Test files | `*.test.ts`, mocha + `node:assert/strict` |
| JSON output | `stableStringify()` for determinism |
| Path handling | `toPosix()` everywhere; no raw backslashes in output |

---

## Phase 4 Status

> Extension calls CLI for generation, instruction emission, and impact
> analysis; falls back to in-process when CLI unavailable.

**Done:**
1. ✅ CLI test coverage expanded (49 tests covering all commands/flags).
2. ✅ New CLI flags: `--kb-only`, `--instructions-mode`.
4. ✅ New CLI command: `aspectcode deps impact --file <path> --json`.
5. ✅ Extension spawns CLI for KB generation (`generate --json --kb-only`).
6. ✅ Extension spawns CLI for instructions (`generate --json`).
7. ✅ Extension spawns CLI for impact (`deps impact --file <path> --json`).
7. ✅ `CliAdapter.ts` with hybrid resolution (local → npm → PATH).

**Remaining:**
- Full watch delegation via CLI subprocess (`cliWatch` helper exists, not yet primary path).
- `state.ts` cleanup (mutable singleton → scoped context).
- Remove remaining extension-side `DependencyAnalyzer` / `importExtractors` once CLI path is stable.

Optional: `aspectcode watch --json` with streaming updates (newline-
delimited JSON) for live regeneration without polling.
