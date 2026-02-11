# Contributing

Thanks for your interest in contributing to Aspect Code!

## Quick Start

```bash
cd extension
npm install
npm run build
```

Open the `extension/` folder in VS Code, press **F5** to launch the
Extension Development Host.

## Development Scripts

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

## What to Work On

- Bug fixes and reliability improvements
- Documentation improvements
- Small, focused UX improvements in the panel
- Reducing the size of grandfathered large files (see `docs/ARCHITECTURE.md`)

If you're unsure, open an issue describing what you want to change.

## Architecture Rules

Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** before making changes.
Key rules:

1. **File size limit:** New files must be ≤ 400 lines. Grandfathered files
   must not grow beyond their current cap.
2. **Layering:** `services/` must not import from `panel/`, `assistants/`,
   `commandHandlers`, or `extension.ts`.
3. **Formatting:** All code is formatted with Prettier. Run `npm run format`
   before committing.
4. **Linting:** All code must pass ESLint. Run `npm run lint` before
   committing.
5. **Types:** Shared types go in `src/types/`. Prefer explicit types over
   `any`.

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
