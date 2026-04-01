# CLAUDE.md — aspectcode

## Repository Structure

This is a TypeScript monorepo with 5 packages:

```
packages/
├── core/       — Static analysis: tree-sitter parsing, dependency graph, hub detection
├── emitters/   — KB content generation, AGENTS.md templates, scoped rule serialization
├── evaluator/  — Probe-and-refine loop: probe generation, simulation, judging, diagnosis, edit application
├── optimizer/  — LLM provider abstraction (OpenAI, Anthropic, hosted proxy), retry logic
└── cli/        — Main CLI: pipeline orchestration, dashboard UI (Ink), auth, settings, watch mode
```

## Build & Test

```bash
npm run build --workspaces    # Build all packages (order matters: core → emitters → evaluator → optimizer → cli)
npm test --workspaces         # Run all tests (mocha + ts-node)

# Single package:
cd packages/cli && npm run build
cd packages/cli && npm test

# Type-check without building:
cd packages/cli && npx tsc --noEmit
```

**IMPORTANT:** When changing `packages/optimizer/src/providers/`, you MUST rebuild the optimizer (`cd packages/optimizer && npx tsc`) before building the CLI. The CLI uses the compiled `dist/` output, not the source. Same applies to changes in `packages/evaluator/` and `packages/emitters/`.

## Key Architecture Decisions

### AGENTS.md Generation
- `packages/cli/src/agentsMdRenderer.ts` generates AGENTS.md directly from the `AnalysisModel`. No intermediate KB extraction, no table parsing. Matches the sweagent_bench format (3000 char budget).
- The old `generateKbCustomContent` / `generateKbSeedContent` paths in emitters are legacy and should not be the primary path.

### LLM Provider Resolution (packages/optimizer/src/providers/index.ts)
Priority order:
1. `ASPECTCODE_LLM_KEY` env var → direct provider
2. `LLM_PROVIDER` explicitly set → direct provider
3. Logged in (CLI token) → hosted proxy at aspectcode.com/api/cli/llm
4. Legacy: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (only if not logged in)

The hosted proxy provider is in `packages/optimizer/src/providers/aspectcode.ts`.

### Scoped Rules
- The dream cycle is the **sole author** of scoped rules. No static analysis rules are written directly to disk.
- `packages/cli/src/scopedRules.ts` contains extractors (hub, convention, circular dep) but these are only used as context for the LLM, not written directly.
- Rules are written via `writeRulesForPlatforms()` which handles multiple platforms (Claude Code, Cursor, Copilot, etc.).

### Dream Cycle (packages/cli/src/dreamCycle.ts)
- Fires autonomously: 3 seconds after entering watch mode (session-start review), then every 2 minutes if corrections exist.
- The LLM reviews AGENTS.md + all scoped rules + corrections. It can edit AGENTS.md, create/update/delete scoped rules.
- No manual `[d]` button — fully autonomous.

### Auto-Resolve (packages/cli/src/autoResolve.ts)
- Every file change assessment goes through LLM judgment with a confidence score.
- High confidence → auto-resolved silently. Low confidence → shown to user with 30s override timer.
- The LLM's answer is always the default.

### Usage Tracking (packages/cli/src/usageTracker.ts)
- Wraps any LLM provider to intercept all calls and accumulate token usage + cost.
- All providers in pipeline.ts and optimize.ts should be wrapped with `withUsageTracking()`.

### Platform Support
- Multi-select on first run. Stored in `aspectcode.json` as `platforms: ["claude", "cursor", ...]`.
- Claude Code: `.claude/rules/ac-*.md`
- Cursor: `.cursor/rules/ac-*.mdc`
- Copilot/Windsurf/Cline/Gemini/Aider: single instruction file

## Pipeline Flow (packages/cli/src/pipeline.ts)

```
main.ts
  → resolveRunMode (ownership prompt, saved to aspectcode.json)
  → resolvePlatforms (multi-select survey, saved to aspectcode.json)
  → mount Ink dashboard
  → runPipeline()
      → runOnce()
          1. Discover & read files
          2. Analyze (tree-sitter → AnalysisModel)
          3. Build KB content
          4. Read existing tool instruction files
          5. Render base AGENTS.md (agentsMdRenderer.ts)
          6. tryOptimize() — if LLM available, runs probe-and-refine
          7. Write AGENTS.md
          8. Populate memory map
      → Enter watch mode
          - Auto-dream (session start + timer)
          - File change → evaluateChange → auto-resolve → push to UI
          - [r] → probe-and-refine
          - [s] → settings panel
```

## Testing Conventions

- Mocha + Node.js built-in assertions (`node:assert/strict`)
- Test files: `packages/*/test/*.test.ts`
- Mocking: `fakeProvider()` in test helpers creates providers with canned responses
- File system tests: use `os.tmpdir()` + `beforeEach/afterEach` cleanup
- No external test libraries (no sinon, chai, jest)

## Common Gotchas

1. **Optimizer dist not rebuilt** — If you add/modify files in `packages/optimizer/src/providers/`, the CLI won't see them until you rebuild the optimizer: `cd packages/optimizer && npx tsc`
2. **Dynamic imports in optimize.ts** — `loadCredentials` must be statically imported, not dynamically. Dynamic `await import('./auth')` can cause timing issues.
3. **Provider resolution catch blocks** — Always catch with `(err)` parameter and log the error message. Bare `catch {}` hides the root cause.
4. **Scoped rule convention threshold** — Set to 2 files minimum. The LLM decides what's worth a rule during the dream cycle, not a hard threshold.
