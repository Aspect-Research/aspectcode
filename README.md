<div align="center">

# Aspect Code

**Knowledge Base Generator for AI Coding Assistants**

</div>

---

## Overview

Aspect Code generates a project-local knowledge base (`kb.md`) and
assistant-specific instruction files that help AI coding assistants understand
your codebase before making changes. It works as a VS Code extension or a
standalone CLI — both produce identical output. **Everything runs offline**
with zero network dependencies.

- Marketplace/end-user README: see `extension/README.md`
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

- **Knowledge Base generation** — Generates a single `kb.md` file (opt-in via `--kb` flag or `generateKb` config setting)
- **AI instruction files** — Generates an `AGENTS.md` instruction file for AI coding assistants
- **Dependency analysis** — Import/export/call graph with hub detection
- **Incremental updates** — Regenerates on save / idle (extension), on file changes with `watch` (CLI), or on-demand
- **Fully offline** — No telemetry, no API calls, no network access

## Supported Languages

Python, TypeScript, JavaScript, Java, C#

---

## Repository Structure

```
aspectcode/
├── packages/
│   ├── core/        @aspectcode/core      Pure analysis engine
│   ├── emitters/    @aspectcode/emitters   Artifact generation
│   └── cli/         aspectcode             CLI entry point
├── extension/                              VS Code extension
└── docs/                                   Architecture & guides
```

See [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md) for the
full architecture, data flow, and package API reference.

## Quick Start (Development)

```bash
npm install                     # install all workspace deps
npm run build --workspaces      # build core → emitters → cli
npm test --workspaces           # run all 149 tests
```

### Extension Development

```bash
cd extension
npm run build
# Press F5 in VS Code to launch Extension Development Host
```

### CLI Usage

```bash
node packages/cli/bin/aspectcode.js generate      # build KB artifacts
node packages/cli/bin/aspectcode.js generate -v   # verbose output
node packages/cli/bin/aspectcode.js generate --kb-only  # KB only, skip instructions
node packages/cli/bin/aspectcode.js generate --list-connections --file src/app.ts
node packages/cli/bin/aspectcode.js deps impact --file src/app.ts   # impact analysis
node packages/cli/bin/aspectcode.js deps list --file src/app.ts
node packages/cli/bin/aspectcode.js watch         # watch + regenerate on changes
node packages/cli/bin/aspectcode.js watch --mode idle
node packages/cli/bin/aspectcode.js show-config
node packages/cli/bin/aspectcode.js set-update-rate idle
node packages/cli/bin/aspectcode.js generate --kb     # include KB (kb.md)
node packages/cli/bin/aspectcode.js add-exclude dist
node packages/cli/bin/aspectcode.js remove-exclude dist
```

## Key Documentation

| Document | Purpose |
|----------|---------|
| [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md) | System architecture, package APIs, data flow |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Extension layering rules, file size limits |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow, PR process |

## CI and Test Tiers

- **PR CI** (`.github/workflows/ci-pr.yml`)
  - `packages/cli` tests
  - `packages/emitters` tests
  - extension CLI adapter integration test
  - Windows sandbox CLI smoke tests
- **Nightly CI** (`.github/workflows/nightly-cli-repos.yml`)
  - Multi-repo cross-language CLI matrix

Local equivalents:

```bash
npm run test:ci:pr
npm run test:ci:repos
```

## Releases

Pushing a tag like `v0.1.1` creates a GitHub Release with the `.vsix`
attached (via `.github/workflows/release.yml`).

## License

See LICENSE.md.