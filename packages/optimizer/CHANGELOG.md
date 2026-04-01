# @aspectcode/optimizer

## 1.0.1

### Patch Changes

- [#37](https://github.com/Aspect-Code-Labs/aspectcode/pull/37) [`6c02094`](https://github.com/Aspect-Code-Labs/aspectcode/commit/6c02094a369de2daba5c7e7dbfa40b6270f196d4) Thanks [@asashepard](https://github.com/asashepard)! - Fix global install on macOS: bundle web-tree-sitter in the CLI tarball so the tree-sitter parser loads correctly, and use os.homedir() for reliable home directory resolution across platforms.

## 1.0.0

### Major Changes

- [#24](https://github.com/Aspect-Code-Labs/aspectcode/pull/24) [`e8e8c53`](https://github.com/Aspect-Code-Labs/aspectcode/commit/e8e8c5328c85cf55a74008fb8f53bd74b4651351) Thanks [@asashepard](https://github.com/asashepard)! - v1.0.0 — First major release.

  Dream cycle, auto-resolve, scoped rules, multi-platform support, memory map dashboard, probe-and-refine improvements, community preferences/suggestions, auto-update, 11 tree-sitter languages.

## 0.4.0

### Minor Changes

- [#20](https://github.com/asashepard/aspectcode/pull/20) [`f86ecf9`](https://github.com/asashepard/aspectcode/commit/f86ecf9e020b50b723df3d00f323653fc6165c8d) Thanks [@asashepard](https://github.com/asashepard)! - Dashboard UX improvements: summary card showing sections/rules/file coverage after generation, token usage display, first-run onboarding message, diff summary on regeneration, and `--compact` flag to hide banner and reasoning. Reasoning display collapsed to a single short line. Added `chatWithUsage` to LLM providers for token counting.

## 0.3.4

### Patch Changes

- [#16](https://github.com/asashepard/aspectcode/pull/16) [`cdb5511`](https://github.com/asashepard/aspectcode/commit/cdb5511bfc29977db995bbc07b0a7ce54cf961d2) Thanks [@asashepard](https://github.com/asashepard)! - Add evidence-based evaluation to the optimization pipeline

  - New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
  - Optimizer now accepts evaluator feedback to self-correct instructions across iterations
  - CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
  - CI workflows updated to build and test the evaluator package in dependency order

## 0.3.2

### Patch Changes

- [#12](https://github.com/asashepard/aspectcode/pull/12) [`4c170b8`](https://github.com/asashepard/aspectcode/commit/4c170b85ebb5080070a49a7fcb3dbf9836508526) Thanks [@asashepard](https://github.com/asashepard)! - Improve CLI experience with React-based dashboard and better output

  - Add interactive React CLI dashboard using Ink for real-time status updates
  - Add complaint processor for structured error handling and reporting
  - Condense and improve continuous mode status output
  - Update optimizer agent with expanded prompts and streaming support

## 0.3.1

### Patch Changes

- [#10](https://github.com/asashepard/aspectcode/pull/10) [`2e74adc`](https://github.com/asashepard/aspectcode/commit/2e74adca877ceab771d1087001069b1b7e9d9a52) Thanks [@asashepard](https://github.com/asashepard)! - Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)

## 0.3.0

### Minor Changes

- [#8](https://github.com/asashepard/aspectcode/pull/8) [`5e94aec`](https://github.com/asashepard/aspectcode/commit/5e94aecd0ee217d833e9f06693f69b78c63ff3dd) Thanks [@asashepard](https://github.com/asashepard)! - Fix CI build order: optimizer now builds before CLI across all workflows and scripts
