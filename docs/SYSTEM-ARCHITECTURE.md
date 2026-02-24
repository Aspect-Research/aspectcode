# System Architecture

> Source-of-truth for layering, package responsibilities, and data flow.

---

## Overview

Aspect Code generates a project-local knowledge base (`.aspect/` directory)
that helps AI coding assistants understand a codebase before making changes.
It produces KB files (opt-in via `--kb` flag), an `AGENTS.md` instruction file
(full-file ownership, no markers), and optionally optimizes `AGENTS.md` via
an agentic LLM loop.

**Everything runs offline** by default. There are no network calls, no telemetry,
no phone-home checks. WASM grammars ship in-repo; all analysis is local.
The only network usage is the opt-in LLM optimizer (requires API key).

---

## Package Map

```
aspectcode/                         ← npm workspaces root
├── packages/
│   ├── core/       @aspectcode/core       Pure analysis (no vscode)
│   ├── emitters/   @aspectcode/emitters   Artifact generation
│   ├── optimizer/  @aspectcode/optimizer   LLM-based optimization
│   └── cli/        aspectcode             CLI entry point (npm package)
├── extension/                             VS Code extension (thin launcher)
└── docs/                                  This file, guides
```

### Dependency Graph

```
  ┌─────────────┐
  │  extension   │──spawns──▶ aspectcode (subprocess)
  │  (VS Code)   │
  └─────────────┘
        │
  ┌─────────────┐
  │     cli      │──uses──▶ @aspectcode/core
  │  (Node.js)   │──uses──▶ @aspectcode/emitters
  │              │──uses──▶ @aspectcode/optimizer
  └─────────────┘
        │
        ▼
  ┌─────────────┐     ┌────────────────┐     ┌────────────────┐
  │    core      │◀────│    emitters     │     │   optimizer    │
  └─────────────┘     └────────────────┘     └────────────────┘
```

**Rule:** `core` has zero knowledge of `emitters`, `optimizer`, `cli`, or
`extension`. `emitters` depends on `core` only. `optimizer` depends on
`core` + `emitters`. `cli` depends on all three. `extension` spawns the
CLI as a subprocess — no direct package imports.

---

## Package Details

### @aspectcode/core

Pure TypeScript. No `vscode` import, no Node-specific I/O beyond
`fs` and `path`. Target: ES2020 / CommonJS.

| Export | Purpose |
|--------|---------|
| `analyzeRepo(root, files)` | Build an `AnalysisModel` from source files |
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
| `createInstructionsEmitter()` | AGENTS.md instruction file emitter (full-file ownership) |
| `stableStringify(value)` | Deterministic JSON (sorted keys) |
| `GenerationTransaction` | Atomic writes — temp files → rename, manifest last |

Key types: `EmitterHost`, `EmitOptions`, `EmitReport`, `Emitter`,
`InstructionsMode`.

### @aspectcode/optimizer

LLM-based optimization for AGENTS.md content. Uses an agentic loop:
evaluate current content → generate improvements → accept if quality
threshold met.

| Export | Purpose |
|--------|---------|
| `createAgent()` | Create an optimizer agent with configurable provider/model |
| Providers | OpenAI and Anthropic adapters |

Key types: `OptimizerOptions`, `AgentResult`.

### aspectcode (CLI)

Node.js command-line interface. Depends on `core`, `emitters`, and
`optimizer`. No subcommands — single command with flags.

**Usage:** `aspectcode [options]`

The pipeline: discover files → analyze → build KB in memory → emit
artifacts → optimize AGENTS.md (if API key available) → watch for changes.

| Flag | Short | Purpose |
|------|-------|---------|
| `--help` | `-h` | Show help |
| `--version` | `-V` | Print version |
| `--verbose` | `-v` | Show debug output |
| `--quiet` | `-q` | Suppress non-error output |
| `--root <path>` | `-r` | Workspace root (default: cwd) |
| `--kb` | | Also write kb.md to disk |
| `--dry-run` | | Print output without writing |
| `--once` | | Run once then exit (no watch) |
| `--no-color` | | Disable colored output |
| `--provider <name>` | `-p` | LLM provider: `openai` or `anthropic` |
| `--model <name>` | `-m` | LLM model override |
| `--max-iterations <n>` | `-n` | Max LLM agent iterations (default: 3) |
| `--accept-threshold <n>` | | Min eval score to accept (1–10, default: 8) |
| `--temperature <n>` | | Sampling temperature (0–2) |

Config file: `aspectcode.json`.

### extension/

VS Code extension. Ultra-thin launcher: resolves the CLI binary,
spawns `aspectcode` as a subprocess in watch mode, and provides
Start/Stop commands in the Command Palette plus a status bar indicator.

Single source file: `extension/src/extension.ts`.

---

## Data Flow

### CLI Pipeline (`aspectcode --once`)

```
aspectcode --once
  │
  ├─ 1. discoverFiles(root)              @aspectcode/core
  ├─ 2. read file contents               Node built-in
  ├─ 3. analyzeRepo(root, fileMap)        @aspectcode/core
  ├─ 4. runEmitters(model, host, opts)    @aspectcode/emitters
  │    ├─ KB emitter → .aspect/ (when --kb)
  │    └─ Instructions emitter → AGENTS.md (full-file ownership)
  └─ 5. optimizer (when API key present)  @aspectcode/optimizer
       └─ evaluate → improve → accept loop on AGENTS.md
```

### CLI Pipeline (watch mode, default)

```
aspectcode
  │
  ├─ 1. run pipeline (same as --once)
  ├─ 2. start filesystem watchers
  └─ 3. re-run pipeline on file changes
       └─ keep process alive until SIGINT/SIGTERM
```

### Extension Pipeline

```
User clicks Start (or auto-start on activation)
  │
  └─ extension.ts → spawn `aspectcode` subprocess (watch mode)
     └─ CLI runs its pipeline, watches, auto-updates
```

---

## File Outputs

| File | Source | Content |
|------|--------|---------|
| `.aspect/architecture.md` | KB emitter | Hub files, directory tree, entry points |
| `.aspect/map.md` | KB emitter | Data models, symbol index, conventions |
| `.aspect/context.md` | KB emitter | Module clusters, integrations, data flow |
| `.aspect/manifest.json` | Manifest writer | Schema version, stats, file list |
| `AGENTS.md` | Instructions emitter | AI agent instructions (full-file ownership) |

`AGENTS.md` is fully owned by Aspect Code — the entire file is overwritten
on each generation. No markers are used.

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
| Tree-sitter WASM | `.wasm` files committed in `extension/parsers/` and `packages/core/parsers/` |
| NPM packages | root `package-lock.json`; `npm ci --prefer-offline` works |
| Build tools | `tsc`, `esbuild`, `mocha` — all local binaries |
| Telemetry | None. Zero network calls (except opt-in optimizer) |
| VSIX packaging | `parsers/` included via `.vscodeignore` allowlist |

---

## Testing

| Package | Runner | Notes |
|---------|--------|-------|
| `@aspectcode/core` | mocha + ts-node | Snapshot tests against fixture repo |
| `@aspectcode/emitters` | mocha + ts-node | KB, instructions, manifest, transaction |
| `@aspectcode/optimizer` | mocha + ts-node | Agent, prompt, provider |
| `aspectcode` | mocha + ts-node | parseArgs, config, generate, settings, watch |

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
