---
"aspectcode": patch
"@aspectcode/evaluator": patch
"@aspectcode/optimizer": patch
"@aspectcode/emitters": patch
---

Add evidence-based evaluation to the optimization pipeline

- New `@aspectcode/evaluator` package: harvests real prompts from local AI tool logs (Claude Code, Cline, Aider, VS Code Copilot), runs probe-based micro-tests against generated KB content, and diagnoses failures with targeted fixes
- Optimizer now accepts evaluator feedback to self-correct instructions across iterations
- CLI dashboard overhauled: terminal clears before launch, setup notes show config/API key/tool status, evaluator progress displays harvest counts, probe pass rates, and diagnosis fixes in real time with a live elapsed timer; complaint input hidden during active work phases
- CI workflows updated to build and test the evaluator package in dependency order
