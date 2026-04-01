# Contributing

Thanks for your interest in contributing to Aspect Code!

## Quick Start

```bash
npm install                        # install all workspace deps
npm run build --workspaces         # build core → emitters → evaluator → optimizer → cli
npm test --workspaces              # run all tests
```

## Architecture Overview

Aspect Code is a TypeScript monorepo with 5 packages. Data flows in one direction:

```
core (parse + graph) → emitters (KB content) → evaluator (probe loop) → optimizer (LLM calls)
                                    ↑
                              cli (orchestrates everything)
```

**`@aspectcode/core`** — Static analysis engine. Tree-sitter parsing, dependency graph construction, hub detection. No runtime deps beyond tree-sitter. No network calls.

**`@aspectcode/emitters`** — KB content builders (architecture, map, context sections) and AI platform format definitions. Depends only on core.

**`@aspectcode/evaluator`** — Probe-and-refine loop: generate probes, simulate AI responses, judge quality, diagnose gaps, apply edits. Depends on core + optimizer.

**`@aspectcode/optimizer`** — LLM provider abstraction (OpenAI, Anthropic, hosted proxy). Retry logic. Depends on nothing internal.

**`aspectcode` (cli)** — CLI entry point. Pipeline orchestration, Ink dashboard, watch mode, auto-resolve, dream cycle, auth, config. Depends on all four packages.

Full details: [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md)

## Development Scripts

### Root (all packages)

| Command | What it does |
|---------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run build --workspaces` | Build in dependency order |
| `npm test --workspaces` | Run all package tests |

### Per package (`cd packages/core`, etc.)

| Command | What it does |
|---------|-------------|
| `npm run build` | Build with tsc |
| `npm run typecheck` | Type-check only (no emit) |
| `npm test` | Run mocha tests |

### CLI sandbox testing

Always test the CLI in a sandbox to avoid writing into the repo root:

```bash
npm run test:cli              # full: build + sandbox test
npm run test:cli:fast         # fast: skip build
```

```powershell
.\scripts\test-cli-sandbox.ps1 -SkipBuild -SkipCleanup    # keep sandbox for inspection
```

### Multi-repo testing

```bash
npm run test:cli:repos        # clone real OSS repos + test
npm run test:cli:repos:fast   # skip build
```

## CI Tiers

| Tier | Workflow | Runs on | What it tests |
|------|----------|---------|---------------|
| Main | `ci.yml` | Every push to main + PRs | Build + test all packages, bundled deps check |
| PR | `ci-pr.yml` | PRs | Windows sandbox CLI smoke tests |
| Nightly | `nightly-cli-repos.yml` | Scheduled | Multi-repo cross-language validation |

## Web App Boundary

Aspect Code has two parts: the **open-source CLI** (this repo) and the **closed-source web app** at `aspectcode.com`. The web app handles auth, the LLM proxy, preference sync, and billing.

### API Endpoints (CLI → Web App)

| Endpoint | Method | Purpose | Required? |
|----------|--------|---------|-----------|
| `/api/cli/auth` | GET (browser) | OAuth login flow | Yes (for login) |
| `/api/cli/verify` | POST | Verify token, get tier + usage | No (cached offline) |
| `/api/cli/llm` | POST | LLM proxy (Haiku 4.5) | No (BYOK bypasses) |
| `/api/cli/preferences` | GET/POST | Sync learned preferences | No (empty offline) |
| `/api/cli/settings` | GET/PUT | User settings sync | No (empty offline) |
| `/api/cli/suggestions` | GET | Community suggestions | No (empty offline) |
| `/api/cli/usage` | GET | Token usage stats | No (CLI command only) |

### Files that touch the web app

These files define the protocol between CLI and web app. **Coordinate with the web app team before modifying these:**

| File | What it does |
|------|-------------|
| `packages/cli/src/auth.ts` | OAuth flow, token storage, verify calls |
| `packages/cli/src/preferences.ts` | Preference sync schema and API calls |
| `packages/cli/src/config.ts` | Settings sync (loadUserSettings, saveUserSettings) |
| `packages/optimizer/src/providers/aspectcode.ts` | LLM proxy protocol |

### Files safe to modify freely

Everything else can be changed without affecting the web app:

- `packages/core/` — analysis engine (no network calls)
- `packages/emitters/` — KB content and platform formats
- `packages/evaluator/` — probe-and-refine logic
- `packages/cli/src/ui/` — dashboard components
- `packages/cli/src/changeEvaluator.ts` — assessment rules
- `packages/cli/src/agentsMdRenderer.ts` — AGENTS.md content
- `packages/cli/src/scopedRules.ts` — scoped rule generation
- `packages/cli/src/dreamCycle.ts` — dream cycle algorithm

## Common Contributor Tasks

### Adding a new AI platform

1. Add detection paths in `packages/emitters/src/instructions/formats.ts` — add entries to `AI_TOOL_DETECTION_PATHS`
2. Add scoped rule writer in `packages/cli/src/scopedRules.ts` — handle the new platform in `writeScopedRulesForPlatform()`
3. Add platform option in `packages/cli/src/pipeline.ts` — add to the multi-select survey list

### Adding a new change evaluation rule

1. Add a check function in `packages/cli/src/changeEvaluator.ts` (must be pure/sync, no LLM calls)
2. Wire it into `evaluateChange()` in the same file
3. Done — it automatically flows through preferences, batch auto-resolve, and dream cycle

### If an AI platform changes its file scheme

Example: Claude Code changes from `.claude/rules/` to a new path.

1. Update `AI_TOOL_DETECTION_PATHS` in `packages/emitters/src/instructions/formats.ts`
2. Update `writeScopedRulesForPlatform()` in `packages/cli/src/scopedRules.ts`
3. No web app changes needed — platform file paths are entirely client-side

### Adding a new LLM provider

1. Create a provider file in `packages/optimizer/src/providers/` (implement the `LlmProvider` interface)
2. Add resolution logic in `packages/optimizer/src/providers/index.ts`
3. The CLI wraps all providers with `withUsageTracking()` automatically

## Releasing

Versioning uses [changesets](https://github.com/changesets/changesets):

1. On your feature branch: `npm run changeset` — select packages, bump type, write summary
2. Commit the `.changeset/*.md` file with your PR
3. When merged, the Release workflow opens a version-bump PR
4. Maintainer merges the version PR → auto-publishes to npm + creates GitHub Releases

Check status: `npm run changeset:status`

## Architecture Rules

1. **Package boundaries:** core has no deps beyond tree-sitter. emitters depends only on core. No cycles.
2. **File size:** New files should be ≤ 400 lines.
3. **Pure checks:** Change evaluator functions must be sync and pure (no LLM, no I/O beyond RuntimeState).
4. **Types:** Prefer explicit types over `any`. Shared types go in the appropriate package.

## Pull Requests

- Keep PRs small and focused
- Add tests when there's a clear place to do so
- CI must pass before merge
- Don't mix style changes with logic changes

## License

By contributing, you agree that your contributions will be licensed under this repository's [MIT license](LICENSE.md).
