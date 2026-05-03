---
"aspectcode": patch
"@aspectcode/optimizer": patch
---

Remove paid Pro tier and force BYOK on hosted exhaustion; community suggestions now run for all users regardless of tier; graceful handling of BYOK key exhaustion (OpenAI insufficient_quota, Anthropic credit balance, invalid keys) with dedicated dashboard prompt and skipped retries; BYOK usage display shows session counts only with no `remaining` messaging; smart-ignore propagates BYOK exhaustion to the dashboard at startup instead of silently swallowing it.
