# Aspect Code

**Knowledge Base Generator for AI Coding Assistants**

Aspect Code generates a knowledge base (`kb.md`) and instruction files that help AI coding assistants understand your codebase architecture before making changes.

---

## What It Does

- **Generates Knowledge Base** — Creates a single `kb.md` file describing your project structure (opt-in)
- **Creates AI Instruction File** — Generates an `AGENTS.md` instruction file for AI coding assistants
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
| `kb.md` | Architecture, data models, module clusters, integrations || `AGENTS.md` | AI assistant instruction file with coding rules |
---

## Instruction Modes

| Mode | Description |
|------|-------------|
| **Safe** | Full guardrails — explicit rules for testing, imports, error handling |

The extension enforces safe-only mode. The CLI (`aspectcode generate --instructions-mode`)
supports additional modes (`permissive`, `off`) for advanced workflows.

---

## Commands

| Command | Description |
|---------|-------------|
| Generate | Generate KB and AGENTS.md instruction file |
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
