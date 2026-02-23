# Contributing

Thanks for your interest in contributing to Aspect Code!

## Quick Start

```bash
# From repo root — installs all workspace packages
npm install

# Build all packages (core → emitters → cli → extension)
npm run build --workspaces
cd extension && npm run build && cd ..

# Run all tests
npm test --workspaces
```

Open the repo root in VS Code, press **F5** to launch the Extension
Development Host.

## Repository Structure

```
packages/core/        @aspectcode/core      Pure analysis (no vscode)
packages/emitters/    @aspectcode/emitters   Artifact generation
packages/cli/         aspectcode             CLI entry point
extension/                                   VS Code extension
docs/                                        Architecture & guides
```

Full architecture: [docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md)

## Development Scripts

### Root (all packages)

| Command | What it does |
|---------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run build --workspaces` | Build core → emitters → cli |
| `npm test --workspaces` | Run all package tests |

### Extension (`cd extension`)

| Command | What it does |
|---------|-------------|
| `npm run build` | Build the extension with esbuild |
| `npm run watch` | Rebuild on file changes |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format all source files with Prettier |
| `npm run format:check` | Check formatting (CI uses this) |
| `npm run check:filesize` | Check file size limits |
| `npm run check:boundaries` | Check dependency boundary rules |
| `npm run check:all` | Run all checks (lint + format + filesize + boundaries) |

### Any package (`cd packages/core`, etc.)

| Command | What it does |
|---------|-------------|
| `npm run build` | Build with tsc |
| `npm run typecheck` | Type-check only |
| `npm test` | Run mocha tests |

## CLI Testing (Safe Sandbox)

When manually exercising the CLI during development, **always use the
sandbox test runner** to avoid writing `kb.md` or `AGENTS.md` into
the repo root:

```bash
# Full run: build all packages, then test CLI in temp sandbox
npm run test:cli

# Fast run: skip build (assumes packages are already compiled)
npm run test:cli:fast
```

You can also run the script directly for extra options:

```powershell
# Keep sandbox for manual inspection after the run
.\scripts\test-cli-sandbox.ps1 -SkipBuild -SkipCleanup
```

The sandbox script copies `extension/test/fixtures/mini-repo` into a
temp directory and runs all CLI commands with explicit `--root` and
`--out` flags pointing there. It verifies the repo root stays clean.

**For agents / AI coding assistants:** When testing the CLI, always
pass `--root <path>` pointing to a temp copy of the fixture repo, and
`--out <path>` pointing to a temp output directory. Never run
`aspectcode generate` from the repo root without explicit flags.

The VS Code task **"Aspect Code: Test CLI (sandbox)"** is also
available from the Command Palette (Tasks: Run Task).

### Multi-Repo Testing

For comprehensive cross-language validation, the multi-repo test runner
clones real open-source repos and runs the full CLI command matrix
against each one:

```bash
# Full run: build + clone repos + exhaustive tests
npm run test:cli:repos

# Fast run: skip build
npm run test:cli:repos:fast
```

The list of repos is defined in `scripts/test-repos.json`. You can
filter to a single repo:

```powershell
.\scripts\test-cli-repos.ps1 -SkipBuild -RepoFilter flask
```

The test matrix per repo covers:
- All settings commands (`set-update-rate`, `add-exclude`, `remove-exclude`, `show-config`)
- `generate` with every flag combination (`--kb-only`, `--instructions-mode safe|permissive|off`, `--no-color`, `--verbose`, `--list-connections`)
- `generate --json` with structure validation
- `deps list` and `deps impact` (with `--file`, `--json`, `--list-connections`)
- Error paths (unknown commands, invalid args)
- Repo-root pollution checks after every repo

All cloned repos are deleted after testing. Use `-SkipCleanup` to keep
them for inspection.

## CI Test Tiers

Aspect Code uses three CI tiers:

- **Main CI (`.github/workflows/ci.yml`)** — runs on every push to `main` and every PR
  - Builds and tests all packages (core, emitters, cli)
  - Extension typecheck, lint, format, filesize, boundaries, build
  - Extension CLI adapter integration test
  - Parser parity check (`extension/parsers/` ↔ `packages/core/parsers/`)
- **PR CI (`.github/workflows/ci-pr.yml`)**
  - Windows: sandbox CLI smoke tests (`test:cli:fast`)
- **Nightly CI (`.github/workflows/nightly-cli-repos.yml`)**
  - Windows: exhaustive multi-repo matrix (`test:cli:repos:fast`)

To reproduce PR CI locally:

```bash
npm run test:ci:pr
```

To reproduce nightly multi-repo CI locally:

```bash
npm run test:ci:repos
```

## Releasing

### npm packages (`@aspectcode/core`, `@aspectcode/emitters`, `aspectcode`)

Versioning and publishing is automated via [changesets](https://github.com/changesets/changesets):

1. On your feature branch, run `npm run changeset`. Select the affected
   packages, choose a bump type (patch / minor / major), and write a
   short summary. This creates a `.changeset/*.md` file — commit it with
   your PR.
2. When the PR merges to `main`, the Release workflow detects pending
   changesets and opens a **"chore: version packages"** PR that bumps
   versions, updates `CHANGELOG.md` files, and syncs internal dependency
   versions.
3. A maintainer reviews and merges that PR.
4. The Release workflow runs again, sees new versions with no pending
   changesets, and publishes to npm. GitHub Releases are created
   automatically.

To check the current changeset status: `npm run changeset:status`

### VS Code extension

The extension is versioned independently and published manually:

```bash
cd extension
npx @vscode/vsce package          # produces .vsix
npx @vscode/vsce publish          # publishes to Marketplace
```

### Parser WASM files

Tree-sitter WASM files exist in two places:
- `extension/parsers/` — shipped inside the VSIX
- `packages/core/parsers/` — shipped inside the npm package

These must always be identical. CI enforces this via
`node scripts/check-parser-parity.mjs`. When updating parsers, copy the
files to both directories.

## What to Work On

- Bug fixes and reliability improvements
- Testing — adding tests for existing code
- Reducing the size of grandfathered large files (see `docs/ARCHITECTURE.md`)
- Moving logic from extension into `packages/core` or `packages/emitters`
- CLI enhancements

If you're unsure, open an issue describing what you want to change.

## Architecture Rules

Read **[docs/SYSTEM-ARCHITECTURE.md](docs/SYSTEM-ARCHITECTURE.md)** and
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** before making changes.
Key rules:

1. **Package boundaries:** `core` has no `vscode` import. `emitters` depends
   only on `core`. `cli` depends on both. Extension depends on both.
2. **File size limit:** New files must be ≤ 400 lines. Grandfathered files
   must not grow beyond their current cap.
3. **Layering (extension):** `services/` must not import from
   `assistants/`, `commandHandlers`, or `extension.ts`.
4. **Formatting:** All code is formatted with Prettier. Run `npm run format`
   before committing.
5. **Linting:** All code must pass ESLint. Run `npm run lint` before
   committing.
6. **Types:** Shared types go in the appropriate package (`packages/core/src/`
   or `packages/emitters/src/`). Prefer explicit types over `any`.

## Pull Requests

- Keep PRs small and focused (one feature/fix per PR).
- Prefer simple implementations over heavy abstractions.
- Add/update tests when there's a clear place to do so.
- Avoid reformatting unrelated code (Prettier handles formatting; don't
  mix style changes with logic changes).
- Run `npm run check:all` before pushing.
- CI must pass before merge.

## Development Notes

- The extension should not write any workspace files until the user
  explicitly triggers setup (e.g., via the **+** button).
- When changing packaging/bundling, verify the VSIX contains required
  runtime files (notably the Tree-sitter WASM grammars in `parsers/`).
- The `types/` directory is reserved for shared type definitions. Use it
  for interfaces and types that cross module boundaries.

## License

By contributing, you agree that your contributions will be licensed under
this repository's license (see LICENSE.md).
