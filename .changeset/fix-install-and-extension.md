---
'aspectcode': patch
'@aspectcode/core': patch
'@aspectcode/emitters': patch
'@aspectcode/optimizer': patch
---

Fix CLI global install (bundle transitive deps: web-tree-sitter, openai, anthropic, dotenv), correct build order in all CI workflows and scripts, sync extension VSIX version to CLI on release, and add graceful error handling in the extension (install prompt when CLI not found, warning on crash, no auto-start)
