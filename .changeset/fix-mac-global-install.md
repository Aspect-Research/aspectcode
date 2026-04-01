---
"aspectcode": patch
"@aspectcode/core": patch
"@aspectcode/emitters": patch
"@aspectcode/evaluator": patch
"@aspectcode/optimizer": patch
---

Fix global install on macOS: bundle web-tree-sitter in the CLI tarball so the tree-sitter parser loads correctly, and use os.homedir() for reliable home directory resolution across platforms.
