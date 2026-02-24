<div align="center">

# Aspect Code

**Knowledge Base Generator for AI Coding Assistants**

</div>

---

## Overview

Aspect Code generates a project-local knowledge base (`kb.md`) and an
`AGENTS.md` instruction file that help AI coding assistants understand
your codebase before making changes. It works as a VS Code extension or a
standalone CLI — both produce identical output. **Everything runs offline**
with zero network dependencies.

When an LLM API key is available, Aspect Code can optionally optimize
`AGENTS.md` via an agentic LLM loop (evaluate → improve → accept).

- Marketplace / end-user README: see `extension/README.md`
- Docs: https://aspectcode.com/docs

## Install

### VS Code Extension

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=aspectcode.aspectcode)
- Or download the `.vsix` from the GitHub Release and install via
  "Extensions: Install from VSIX…"

### CLI

```bash
# From the repo root (npm workspaces)
npm install
npm run build --workspaces
node packages/cli/bin/aspectcode.js --help
```

## Features

- **Knowledge Base generation** — Writes `.aspect/architecture.md`, `.aspect/map.md`, `.aspect/context.md`, and `.aspect/manifest.json`
- **AI instruction file** — Generates `AGENTS.md` for AI coding assistants (full-file ownership)
- **Dependency analysis** — Import/export/call graph with hub detection
- **LLM optimization** — Agentic evaluate → improve → accept loop (opt-in, requires API key)
- **Watch mode** — Re-analyzes and updates on file changes (default behavior)
- **Fully offline** — No telemetry, no API calls, no network access (unless optimizer is opted in)

## Supported Languages

Python, TypeScript, JavaScript, Java, C#

---

## Repository Structure

```
aspectcode/
├── packages/
│   ├── core/        @aspectcode/core       Pure analysis engine
│   ├── emitters/    @aspectcode/emitters    Artifact generation
│   ├── optimizer/   @aspectcode/optimizer   LLM-based AGENTS.md optimizer
│   └── cli/         aspectcode              CLI entry point
├── extension/                               VS Code extension (thin launcher)
└── docs/                                    Architecture & guides
```

See [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md) for the
full architecture, data flow, and package API reference.

## Quick Start (Development)

```bash
npm install                     # install all workspace deps
npm run build --workspaces      # build core → emitters → optimizer → cli
npm test --workspaces           # run all tests
```

### Extension Development

```bash
cd extension
npm run build
# Press F5 in VS Code to launch Extension Development Host
```

### CLI Usage

```bash
aspectcode                              # watch & auto-update AGENTS.md
aspectcode --once                       # run once then exit
aspectcode --once --kb                  # also write kb.md
aspectcode --once --dry-run             # preview without writing
aspectcode --provider openai            # force LLM provider for optimizer
aspectcode --verbose                    # show debug output
aspectcode --root /path/to/project      # set workspace root
aspectcode --no-color                   # disable colored output
```

## Key Documentation

| Document | Purpose |
|----------|---------|
| [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md) | System architecture, package APIs, data flow |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Extension layering rules, file size limits |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow, PR process |

## CI and Test Tiers

- **Main CI** (`.github/workflows/ci.yml`)
  - Builds and tests all packages (core, emitters, cli, optimizer)
  - Extension typecheck, lint, format, filesize, boundaries, build
  - Parser parity check
- **PR CI** (`.github/workflows/ci-pr.yml`)
  - Windows: sandbox CLI smoke tests (`test:cli:fast`)
- **Nightly CI** (`.github/workflows/nightly-cli-repos.yml`)
  - Multi-repo cross-language CLI matrix

Local equivalents:

```bash
npm run test:ci:pr
npm run test:ci:repos
```

## Releases

Versioning and publishing is automated via
[changesets](https://github.com/changesets/changesets). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## License

See LICENSE.md.
