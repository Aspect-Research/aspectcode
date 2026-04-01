<div align="center">

# Aspect Code

**Context that learns how you code.**

[![npm](https://img.shields.io/npm/v/aspectcode)](https://www.npmjs.com/package/aspectcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

Aspect Code analyzes your codebase and generates `AGENTS.md` + scoped rules
that AI coding assistants follow when making changes. It watches your project,
learns from your corrections, and keeps instructions current.

[Install](#install) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Tiers](#tiers) · [Contributing](#contributing)

</div>

---

## Install

```bash
npm install -g aspectcode
```

## Quick Start

```bash
aspectcode login            # authenticate (free: 100K lifetime tokens)
aspectcode                  # analyze → generate → watch
```

On first run, Aspect Code will:
1. Ask which AI platforms you use (Claude Code, Cursor, Copilot, etc.)
2. Analyze your codebase with tree-sitter
3. Generate `AGENTS.md` and platform-specific scoped rules
4. Enter watch mode — monitoring file changes in real time

```bash
# Other commands
aspectcode --once           # single run, no watch mode
aspectcode --once --dry-run # preview without writing files
aspectcode usage            # show current tier and token usage
aspectcode upgrade          # open Pro upgrade page
aspectcode whoami           # show logged-in account
aspectcode logout           # clear credentials
```

## How It Works

### Initial Analysis

1. **Parse** — tree-sitter grammars extract imports, exports, classes, and call sites across Python, TypeScript, JavaScript, Java, and C#.
2. **Analyze** — build a dependency graph. Detect high-risk hubs, entry points, naming conventions, and circular dependencies.
3. **Generate** — write `AGENTS.md` with project-specific instructions. If logged in or a key is provided, an LLM refines the output via probe-and-refine evaluation.

### Watch Mode

After the initial run, Aspect Code enters watch mode and monitors your project:

- **Change evaluation** — each file save triggers pure/sync checks (co-change detection, export contract breakage, test coverage gaps, file size, cross-boundary imports, hub detection, inheritance propagation, and more).
- **Auto-resolve** — an LLM batches all warnings into a single call and decides which to enforce and which to suppress. High-confidence decisions are applied automatically; low-confidence ones are shown to you.
- **Preferences** — your confirm/dismiss decisions are learned and cached. The same warning in the same scope never fires the LLM again.
- **Dream cycle** — after enough corrections accumulate, the LLM reviews all feedback and updates `AGENTS.md` and scoped rules autonomously.
- **Auto-probe** — after sustained activity and an idle period, probe-and-refine re-evaluates the full instruction set.

### Output Files

```
your-project/
├── AGENTS.md                    # instruction file for AI assistants
├── .claude/rules/ac-*.md        # Claude Code scoped rules
├── .cursor/rules/ac-*.mdc       # Cursor scoped rules
├── .github/copilot-instructions.md  # Copilot (if selected)
├── aspectcode.json              # project config (commit this)
└── .aspectcode/                 # internal state (gitignore)
    ├── scoped-rules.json
    └── dream-state.json
```

Platform support: **Claude Code**, **Cursor**, **Copilot**, **Windsurf**, **Cline**, **Gemini**, **Aider**.

## Tiers

| | Free | Pro | BYOK |
|---|---|---|---|
| Tokens | 100K lifetime | 1M/week | Unlimited |
| Price | $0 | $8/mo | $0 (your key) |
| Community suggestions | Yes | Yes | No |

**BYOK (Bring Your Own Key):** Add `"apiKey": "sk-..."` to `aspectcode.json` or set `ASPECTCODE_LLM_KEY` in your environment. Full functionality, no account required, no community suggestions.

## Configuration

### aspectcode.json (project-level, committed to repo)

```json
{
  "platforms": ["claude", "cursor"],
  "ownership": "full",
  "exclude": ["vendor/", "generated/"],
  "apiKey": "sk-...",
  "evaluate": {
    "maxProbes": 10,
    "maxIterations": 3,
    "charBudget": 8000
  }
}
```

### Credentials (~/.aspectcode/credentials.json)

Created by `aspectcode login`. Contains your CLI token. Never commit this file.

## Repository Structure

```
packages/
  core/        @aspectcode/core        Static analysis (tree-sitter, dependency graph)
  emitters/    @aspectcode/emitters    KB content generation, platform formats
  evaluator/   @aspectcode/evaluator   Probe-and-refine evaluation loop
  optimizer/   @aspectcode/optimizer   LLM provider abstraction (OpenAI, Anthropic, hosted proxy)
  cli/         aspectcode              CLI entry point, dashboard, watch mode
```

## Development

```bash
npm install                     # install all workspace deps
npm run build --workspaces      # build all packages (order: core → emitters → evaluator → optimizer → cli)
npm test --workspaces           # run all tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, architecture, and release process.

## License

[MIT](LICENSE.md)
