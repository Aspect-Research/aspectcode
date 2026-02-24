# @aspectcode/core

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
