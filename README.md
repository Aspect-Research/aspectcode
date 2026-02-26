<div align="center">

# Aspect Code

**Give your AI coding assistant a map before it writes a single line.**

[![npm](https://img.shields.io/npm/v/aspectcode)](https://www.npmjs.com/package/aspectcode)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/aspectcode.aspectcode)](https://marketplace.visualstudio.com/items?itemName=aspectcode.aspectcode)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

Aspect Code analyzes your codebase and generates `AGENTS.md` — the instruction
file AI coding assistants follow when making changes in your project.

[Install](#install) · [How It Works](#how-it-works) · [CLI](#cli) · [Contributing](#contributing)

</div>

---

## Why

AI assistants hallucinate less and produce better diffs when they know your
architecture, naming conventions, and high-risk files. Aspect Code extracts
that context automatically and keeps it current.

**Everything runs locally.** Zero telemetry. The only optional network call is
the LLM generation step (requires your own API key).

## Install

```bash
npm install -g aspectcode          # CLI
```

Or install the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=aspectcode.aspectcode). Both produce identical output.

## How It Works

1. **Parse** — tree-sitter grammars extract imports, exports, classes, and calls.
2. **Analyze** — build a dependency graph, detect high-risk hubs, cluster co-edited modules.
3. **Generate** — write `AGENTS.md` with project-specific instructions. If an API key is set, an LLM generates guidelines from the static analysis; otherwise a template is written.
4. **Evaluate** *(opt-in)* — run probe micro-tests against the generated instructions and auto-fix gaps.
5. **Watch** — re-run on file changes (default mode).

### Output

```
your-project/
├── AGENTS.md             ← instruction file for AI assistants
└── kb.md                 ← knowledge base (optional, --kb flag)
```

### Supported Languages

Python · TypeScript · JavaScript · Java · C#

## CLI

```bash
aspectcode                     # watch mode — regenerate on changes
aspectcode --once              # single run
aspectcode --once --kb         # also write kb.md
aspectcode --once --dry-run    # preview without writing
aspectcode --compact           # minimal dashboard output
aspectcode --provider openai   # LLM provider (openai | anthropic)
aspectcode --model gpt-4o      # model override
aspectcode --root ./my-project # explicit workspace root
```

Run `aspectcode --help` for all flags.

## Repository Structure

```
packages/
  core/        @aspectcode/core        Static analysis engine
  emitters/    @aspectcode/emitters     KB & instruction generation
  evaluator/   @aspectcode/evaluator    Probe-based evaluation
  optimizer/   @aspectcode/optimizer    LLM generation
  cli/         aspectcode               CLI
extension/                              VS Code extension
```

## Development

```bash
npm install                     # install all workspace deps
npm run build --workspaces      # build all packages
npm test --workspaces           # run all tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow, testing, and release process.

## License

[MIT](LICENSE.md)
