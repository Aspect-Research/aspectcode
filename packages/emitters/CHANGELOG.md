# @aspectcode/emitters

## 0.3.4

### Patch Changes

- [#16](https://github.com/asashepard/aspectcode/pull/16) [`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2) Thanks [@asashepard](https://github.com/asashepard)! - Add evidence-based evaluation to the optimization pipeline

  - New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
  - Optimizer now accepts evaluator feedback to self-correct instructions across iterations
  - CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
  - CI workflows updated to build and test the evaluator package in dependency order

## 0.3.1

### Patch Changes

- [#10](https://github.com/asashepard/aspectcode/pull/10) [`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)

- Updated dependencies [[`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52)]:
  - @aspectcode/core@0.3.1

## 0.3.0

### Minor Changes

- [#8](https://github.com/asashepard/aspectcode/pull/8) [`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd) Thanks [@asashepard](https://github.com/asashepard)! - Fix CI build order: optimizer now builds before CLI across all workflows and scripts

### Patch Changes

- Updated dependencies [[`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd)]:
  - @aspectcode/core@0.3.0

## 0.2.1

### Patch Changes

- [#3](https://github.com/asashepard/aspectcode/pull/3) [`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d) Thanks [@asashepard](https://github.com/asashepard)! - Fix release pipeline: mark extension as private to prevent accidental npm publish, add VSIX build and GitHub Release attachment to CI/CD.

- Updated dependencies [[`711ef83`](https://github.com/asashepard/aspectcode/commit/711ef8399b9b4f8b2132398e5f812bb9c7d2530d)]:
  - @aspectcode/core@0.2.1

## 0.2.0

### Minor Changes

- [#1](https://github.com/asashepard/aspectcode/pull/1) [`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476) Thanks [@asashepard](https://github.com/asashepard)! - Prepare packages for npm publishing. Bundle tree-sitter WASM parsers into
  @aspectcode/core so the CLI works after global install. Add publishConfig
  to CLI. Bump all packages to 0.1.0.

### Patch Changes

- Updated dependencies [[`7ed894a`](https://github.com/asashepard/aspectcode/commit/7ed894a5382dcc57bee39ffd3f02f55bf266e476)]:
  - @aspectcode/core@0.2.0
