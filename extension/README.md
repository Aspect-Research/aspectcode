# Aspect Code

**Knowledge Base Generator for AI Coding Assistants**

Aspect Code generates a structured knowledge base (`.aspect/`) that helps AI coding assistants understand your codebase architecture before making changes.

---

## What It Does

- **Generates `.aspect/` Knowledge Base** — Creates `architecture.md`, `map.md`, and `context.md` files describing your project structure
- **Creates AGENTS.md** — Generates an instruction file for AI coding assistants
- **Visualizes Dependencies** — Interactive dependency graph showing file relationships and hub files
- **Auto-Regenerates** — Updates KB on file save or after idle period or manually (configurable)

---

## Supported Languages

Python, TypeScript, JavaScript, Java, C#

---

## Getting Started

1. Install the extension
2. Open a workspace with supported source files
3. Click the **+** button in the Aspect Code panel to generate the knowledge base
4. AI assistants will automatically pick up the generated instruction files

---

## Generated Files

| File | Purpose |
|------|---------|
| `.aspect/architecture.md` | High-risk hubs, directory layout, entry points |
| `.aspect/map.md` | Data models, symbol index, naming conventions |
| `.aspect/context.md` | Module clusters, external integrations, data flows |

---

## Instruction Modes

| Mode | Description |
|------|-------------|
| **Safe** | Full guardrails — explicit rules for testing, imports, error handling |

The extension enforces safe-only mode. The CLI (`aspectcode generate --instructions-mode`)
supports additional modes (`permissive`, `off`) for advanced workflows.

---

## Output File

| Assistant | Generated File |
|-----------|----------------|
| All | `AGENTS.md` |

---

## Commands

| Command | Description |
|---------|-------------|
| Generate | Generate KB and AGENTS.md |
| Copy KB Receipt Prompt | Copy prompt to verify AI can read KB |
| Enable Safe Mode | Ensure instruction files use safe mode |

---

## Requirements

- VS Code 1.92.0 or higher
- **Works fully offline** — no internet connection required

---

## Docs

https://aspectcode.com/docs

---

## License

Proprietary. See [LICENSE.md](LICENSE.md) for details.

© 2025-2026 Aspect Code. All rights reserved.
