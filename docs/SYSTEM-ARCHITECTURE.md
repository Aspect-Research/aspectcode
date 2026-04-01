# System Architecture

> Source-of-truth for layering, package responsibilities, data flow, and web app integration.

---

## Overview

Aspect Code analyzes a codebase with tree-sitter, builds a dependency graph, generates `AGENTS.md` + platform-specific scoped rules, and enters watch mode to learn from developer corrections. It optionally uses an LLM (via a hosted proxy or BYOK key) for optimization, auto-resolve, and autonomous context refinement.

---

## Package Map

```
aspectcode/                         npm workspaces root
├── packages/
│   ├── core/       @aspectcode/core        Static analysis (tree-sitter, graph)
│   ├── emitters/   @aspectcode/emitters    KB content builders, platform formats
│   ├── evaluator/  @aspectcode/evaluator   Probe-and-refine evaluation loop
│   ├── optimizer/  @aspectcode/optimizer   LLM provider abstraction + retry
│   └── cli/        aspectcode              CLI, dashboard, watch mode, auth
└── docs/                                   This file
```

### Dependency Graph

```
cli ──→ core
cli ──→ emitters ──→ core
cli ──→ evaluator ──→ core, optimizer
cli ──→ optimizer
```

No cycles. Core has zero internal dependencies.

---

## Pipeline Flow

```
main.ts
  → loginCommand() (if not authenticated)
  → resolveRunMode() (ownership: full | section)
  → resolvePlatforms() (multi-select: claude, cursor, copilot, ...)
  → detect tier (BYOK key? → byok | verify endpoint → free/pro)
  → mount Ink dashboard
  → runPipeline()
      → runOnce()
          1. Discover files (walker + exclusions)
          2. Analyze (tree-sitter → AnalysisModel: files, symbols, graph, metrics)
          3. Build KB content (architecture + map + context)
          4. Read existing tool instruction files
          5. Render AGENTS.md (agentsMdRenderer.ts, 3000 char budget)
          6. tryOptimize() — if LLM available, runs probe-and-refine
          7. Write AGENTS.md + scoped rules for selected platforms
          8. Snapshot hub counts for new-hub detection
      → Enter watch mode
          - Session-start dream (3s delay)
          - File watcher (fs.watch, recursive)
          - On file change:
              → 500ms debounce
              → evaluateChange() (12 pure/sync checks)
              → co-change settle window (5s)
              → batch auto-resolve (single LLM call)
              → preference caching
          - Auto-dream timer (every 30s check, fires at 10+ corrections, 2min cooldown)
          - Auto-probe timer (every 60s check, fires at 20+ changes + 5min idle)
          - Manual [r] for immediate probe-and-refine
```

---

## Change Evaluation Rules

All checks are pure functions — no LLM calls, no file I/O beyond RuntimeState. Fast enough to run on every file save.

| Rule | Trigger | What it detects |
|------|---------|-----------------|
| `co-change` | add/change/unlink | Dependents not updated when a file changes |
| `directory-convention` | add | Test/route file in unexpected directory |
| `naming-convention` | add | Filename style doesn't match siblings |
| `import-pattern` | change | New import from a high-risk hub |
| `export-contract` | change | Removed exports with live consumers |
| `circular-dependency` | change | New import creates a cycle |
| `test-coverage-gap` | change | Source changed but test file not updated |
| `file-size` | change | File exceeds 500 lines or grew 100+ lines |
| `new-hub` | change | File's inDegree crossed hub threshold (3+) |
| `cross-boundary` | change | Import crosses top-level directory boundary |
| `stale-import` | change | Imports from a recently deleted file |
| `inheritance-change` | change | Base class modified, children not updated |

---

## LLM Call Map

Every LLM call in the system, when it fires, and approximate token cost:

### During probe-and-refine (1 iteration, 5 probes)

| Call | Count | Input tokens | Output tokens | Model |
|------|-------|-------------|---------------|-------|
| Probe generation | 1 | ~4,000 | ~1,500 | Haiku |
| Probe simulation | 5 | ~2,500 each | ~1,000 each | Haiku |
| Probe judging | 5 | ~2,000 each | ~750 each | Haiku |
| Diagnosis | 1 | ~5,000 | ~1,500 | Sonnet |
| Edit application | 0-1 | ~3,000 | ~2,000 | Haiku |

**Total: ~48K tokens per run, ~13 calls**

### During watch mode

| Call | Frequency | Input tokens | Output tokens |
|------|-----------|-------------|---------------|
| Batch auto-resolve | 1 per debounce batch | ~2,000-3,500 | ~500-1,000 |
| Dream cycle | 1 per 10+ corrections | ~3,000 | ~2,000 |

### Usage tracking

All provider calls are wrapped with `withUsageTracking()` (cli/src/usageTracker.ts). Token counts flow to the dashboard and to the server's `tierUsage` response field.

---

## Web App Integration

The CLI communicates with `aspectcode.com` (or `ASPECTCODE_WEB_URL`) for auth, LLM proxy, and sync. All calls are optional — the CLI works fully offline with a BYOK key.

### Authentication

1. `aspectcode login` opens browser to `/api/cli/auth?port=<PORT>&state=<STATE>`
2. Web app handles Google OAuth, redirects to `localhost:<PORT>/callback?token=<TOKEN>&state=<STATE>`
3. Token stored at `~/.aspectcode/credentials.json` (mode 0o600)
4. All API calls use `Authorization: Bearer <token>`

### API Endpoints

| Endpoint | Method | Data sent | Data returned |
|----------|--------|-----------|---------------|
| `/api/cli/verify` | POST | Bearer token | `{ user, tier, usage: { tokensUsed, tokensCap, resetAt } }` |
| `/api/cli/llm` | POST | `{ messages, temperature, maxTokens, model }` | `{ content, usage, tierUsage }` |
| `/api/cli/preferences` | GET | Bearer token + project query | `{ preferences[] }` |
| `/api/cli/preferences` | POST | `{ project, preferences[] }` | 200 OK |
| `/api/cli/settings` | GET/PUT | Bearer token, optional settings body | `{ settings }` |
| `/api/cli/suggestions` | GET | Bearer token + language query | `{ suggestions[] }` |
| `/api/cli/usage` | GET | Bearer token | `{ tier, tokensUsed, tokensCap, tokensRemaining, resetAt }` |

### LLM Proxy (aspectcode provider)

File: `packages/optimizer/src/providers/aspectcode.ts`

- Routes LLM calls through `aspectcode.com/api/cli/llm`
- Server uses Haiku 4.5 by default, enforces tier token caps
- Returns `tierUsage` in response body for real-time dashboard display
- On exhaustion: returns 403 with `{ error: "token_limit_exceeded", message, tier, upgradeUrl }`
- CLI catches 403, shows upgrade prompt with `[u]` and `[k]` options

### Provider Resolution Order

File: `packages/optimizer/src/providers/index.ts`

1. `ASPECTCODE_LLM_KEY` env var or `apiKey` in aspectcode.json → direct provider (BYOK)
2. `LLM_PROVIDER` explicitly set → direct provider
3. CLI token present → hosted proxy at aspectcode.com
4. Legacy: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`

---

## Platform Output

### Scoped Rules

| Platform | Write location | Format |
|----------|---------------|--------|
| Claude Code | `.claude/rules/ac-{slug}.md` | Markdown with frontmatter |
| Cursor | `.cursor/rules/ac-{slug}.mdc` | Markdown with frontmatter |

### Single Instruction Files

| Platform | Write location |
|----------|---------------|
| Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurfrules` |
| Cline | `.clinerules` |
| Gemini | `GEMINI.md` |
| Aider | `CONVENTIONS.md` |

### Manifest

`.aspectcode/scoped-rules.json` tracks all generated rule files (slug, platform, path, hash, source, timestamps). Used to clean up deleted rules.

---

## Configuration Files

| File | Scope | Committed? | Purpose |
|------|-------|------------|---------|
| `aspectcode.json` | Project | Yes | Platforms, exclusions, evaluate settings, BYOK key |
| `~/.aspectcode/credentials.json` | User | No | CLI auth token + cached tier |
| `.aspectcode/scoped-rules.json` | Project | Optional | Rule file manifest |
| `.aspectcode/dream-state.json` | Project | Optional | Dream cycle state |

---

## Testing

- **Unit tests:** Mocha + Node.js built-in assertions (`node:assert/strict`)
- **Test files:** `packages/*/test/*.test.ts`
- **Mocking:** `fakeProvider()` creates canned LLM responses
- **File system:** `os.tmpdir()` + cleanup in before/afterEach
- **Core package:** Snapshot-based integration testing
- **CLI package:** Integration-focused + sandbox smoke tests
