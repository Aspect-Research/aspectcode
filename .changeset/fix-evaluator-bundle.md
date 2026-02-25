---
"aspectcode": patch
---

Fix CLI global install crash: `Cannot find module '@aspectcode/evaluator'`

- **Root cause:** The prepack script that materialises workspace packages for `npm pack` had a hardcoded list missing `@aspectcode/evaluator`, so it was never included in the published tarball.
- **Fix:** `prepack.mjs` now derives the package list from `bundledDependencies` in `package.json` (single source of truth) and validates each materialised package has `package.json` and `dist/` before packing.
- **CI guard:** New `check:bundled` script scans all runtime `@aspectcode/*` imports in CLI source and fails if any are missing from `bundledDependencies`. Wired into the `test:ci:cli-emitters` pipeline.
- **Theme:** Updated CLI brand color from purple to orange (`#f9731c`).
- **Docs:** Updated README, CONTRIBUTING, ARCHITECTURE, SYSTEM-ARCHITECTURE, and CHANGELOG to reflect the evaluator package, new CI checks, and corrected dependency graph.
