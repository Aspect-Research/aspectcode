# @aspectcode/optimizer

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
