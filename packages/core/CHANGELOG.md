# @aspectcode/core

## 1.0.1

### Patch Changes

- [#37](https://github.com/Aspect-Code-Labs/aspectcode/pull/37) [`6c02094`](https://github.com/Aspect-Code-Labs/aspectcode/commit/6c02094a369de2daba5c7e7dbfa40b6270f196d4) Thanks [@asashepard](https://github.com/asashepard)! - Fix global install on macOS: bundle web-tree-sitter in the CLI tarball so the tree-sitter parser loads correctly, and use os.homedir() for reliable home directory resolution across platforms.

## 1.0.0

### Major Changes

- [#24](https://github.com/Aspect-Code-Labs/aspectcode/pull/24) [`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351) Thanks [@asashepard](https://github.com/asashepard)! - v1.0.0 — First major release.

  Dream cycle, auto-resolve, scoped rules, multi-platform support, memory map dashboard, probe-and-refine improvements, community preferences/suggestions, auto-update, 11 tree-sitter languages.

## 0.3.1

### Patch Changes

- [#10](https://github.com/asashepard/aspectcode/pull/10) [`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)

## 0.3.0

### Minor Changes

- [#8](https://github.com/asashepard/aspectcode/pull/8) [`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd) Thanks [@asashepard](https://github.com/asashepard)! - Fix CI build order: optimizer now builds before CLI across all workflows and scripts

## 0.2.1

### Patch Changes

- [#3](https://github.com/asashepard/aspectcode/pull/3) [`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d) Thanks [@asashepard](https://github.com/asashepard)! - Fix release pipeline: mark extension as private to prevent accidental npm publish, add VSIX build and GitHub Release attachment to CI/CD.

## 0.2.0

### Minor Changes

- [#1](https://github.com/asashepard/aspectcode/pull/1) [`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476) Thanks [@asashepard](https://github.com/asashepard)! - Prepare packages for npm publishing. Bundle tree-sitter WASM parsers into
  @aspectcode/core so the CLI works after global install. Add publishConfig
  to CLI. Bump all packages to 0.1.0.
