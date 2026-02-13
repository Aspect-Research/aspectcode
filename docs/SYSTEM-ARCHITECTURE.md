# System Architecture

> Source-of-truth for layering, package responsibilities, and data flow.
> Last updated: 2026-02-12 (CLI-first migration, test-first execution).

---

## Overview

Aspect Code generates a project-local knowledge base (`.aspect/` directory)
that helps AI coding assistants understand a codebase before making changes.
It produces `architecture.md`, `map.md`, `context.md`, a `manifest.json`,
and optional assistant-specific instruction files.

**Everything runs offline.** There are no network calls, no telemetry, no
phone-home checks. WASM grammars ship in-repo; all analysis is local.

---

## Package Map

```
aspectcode/                         ← npm workspaces root
├── packages/
│   ├── core/       @aspectcode/core      Pure analysis (no vscode)
│   ├── emitters/   @aspectcode/emitters  Artifact generation
│   └── cli/        @aspectcode/cli       CLI entry point
├── extension/                            VS Code extension (thin adapter)
└── docs/                                 This file, guides
```

### Dependency Graph

```
  ┌────────────┐
  │  extension  │──uses──▶ @aspectcode/core
  │  (VS Code)  │──uses──▶ @aspectcode/emitters
  └─────┬───────┘
        │ Phase 4: calls CLI via child_process
        ▼
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
depends on both (and in Phase 4, may invoke the CLI binary instead).

---

## Package Details

### @aspectcode/core

Pure TypeScript. No `vscode` import, no Node-specific I/O beyond
`fs` and `path`. Target: ES2020 / CommonJS.

| Export | Purpose |
|--------|---------|
| `analyzeRepo(root, files)` | Build an `AnalysisModel` from source files (sync, regex-based) |
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
| `createInstructionsEmitter()` | Assistant instruction file manager |
| `stableStringify(value)` | Deterministic JSON (sorted keys) |
| `GenerationTransaction` | Atomic writes — temp files → rename, manifest last |
| `detectAssistants(host, root)` | Detect installed AI assistants by config files |

Key types: `EmitterHost`, `EmitOptions`, `EmitReport`, `Emitter`,
`AssistantFlags`, `InstructionsMode`.

### @aspectcode/cli

Node.js command-line interface. Depends on both `core` and `emitters`.
No external command framework — hand-rolled argv parser.

| Command | Purpose | Output mode |
|---------|---------|-------------|
| `aspectcode init` | Create `aspectcode.json` config file | human-readable |
| `aspectcode generate` | Discover → analyze → emit (full pipeline) | human-readable by default, JSON with `--json`; dependency output can be scoped by `--file` |
| `aspectcode watch` | Watch files and trigger `generate` by mode | long-running process |
| `aspectcode deps list` | Compute and list dependency connections only | human-readable; supports `--file` filter |

Key flags:
- Global-ish: `--root`, `--verbose`, `--quiet`, `--help`, `--version`
- `init`: `--force`
- `generate`: `--out`, `--list-connections`, `--json`, `--file` (for connection filtering)
- `deps list`: `--file` (connection filtering)
- `watch`: `--mode` (`manual|onChange|idle`)

Config file: `aspectcode.json`.

Current config compatibility rules:
- Canonical update key: `updateRate` (`manual | onChange | idle`)
- Legacy key accepted: `autoRegenerateKb` (`off | onSave | idle`) and mapped to canonical values
- Instruction mode is safe-only (`instructionsMode: "safe"` enforced)

### extension/

VS Code extension. Thin adapter: lifecycle, commands, file watchers,
tree-sitter initialization. Delegates analysis and
generation to `core` and `emitters`.

In Phase 4 the extension will shell out to the CLI binary
(`aspectcode generate --json`) and render the result, removing most
inline generation logic.

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
       ├─ KB emitter → .aspect/{architecture,map,context}.md
       ├─ Manifest writer → .aspect/manifest.json
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

### Extension Pipeline (current)

```
User action (click / save / idle)
  │
  ├─ regenerateEverything()   extension/src/assistants/kb.ts
  │   ├─ build AnalysisModel from workspace
  │   └─ runEmitters(model, vscodeHost, opts)
  └─ Status bar update
```

### Extension Pipeline (Phase 4 target)

```
User action (click / save / idle)
  │
  ├─ child_process.exec("aspectcode generate --json")
  │   └─ stdout → EmitReport JSON
  ├─ Render summary in status bar / notification
  └─ dependency listing via CLI (`aspectcode deps list`)
```

---

## File Outputs

| File | Source | Content |
|------|--------|---------|
| `.aspect/architecture.md` | KB emitter | Hub files, directory tree, entry points |
| `.aspect/map.md` | KB emitter | Data models, symbol index, conventions |
| `.aspect/context.md` | KB emitter | Module clusters, integrations, data flow |
| `.aspect/manifest.json` | Manifest writer | Schema version, stats, file list |
| `.github/copilot-instructions.md` | Instructions emitter | Copilot rules (marker-wrapped) |
| `.cursor/rules/aspect.mdc` | Instructions emitter | Cursor rules |
| `CLAUDE.md` | Instructions emitter | Claude rules |
| `AGENTS.md` | Instructions emitter | Generic agent rules |

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
| `@aspectcode/core` | mocha + ts-node | 10 | Snapshot tests against fixture repo |
| `@aspectcode/emitters` | mocha + ts-node | 78 | KB, instructions, manifest, transaction |
| `@aspectcode/cli` | mocha + ts-node | 37 | parseArgs, config compatibility, init, generate, deps |
| Extension | mocha (VS Code test harness) | 1+ | `kb.test.ts` |

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

## Phase 4 Plan (Next)

> Extension calls CLI for generation and dependency listing; CLI behavior is validated first via tests.

1. Expand CLI test coverage for all current command modes/flags.
2. Implement new CLI functionality behind those tests.
3. Extension spawns `aspectcode generate --json` via `child_process`.
4. Extension renders EmitReport summary (status bar / notification).
5. Keep extension UI minimal (status + commands only).

Optional: `aspectcode watch --json` with streaming updates (newline-
delimited JSON) for live regeneration without polling.
