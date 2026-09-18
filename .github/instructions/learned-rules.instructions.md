---
description: Lifecycle rules for the repository's learned agent-instruction corpus
applyTo: '.github/agent-rules/**,.github/prompts/**,.github/skills/**,.github/instructions/**'
---

# Learned rule lifecycle

Use [.github/agent-rules/learned-rules.json](../agent-rules/learned-rules.json) as the bounded
corpus for repeatable agent-instruction lessons.

- Consume only rules whose `state` is `active`; ignore `candidate` and `retired` rules during
  repair, review, and validation runs.
- Promote a `candidate` only after repeated independent evidence shows it adds signal beyond
  existing active instructions.
- Keep the active set at or below `maxActiveRules`; retire or merge stale rules before adding more.
- Preserve evidence paths as repository-relative files and keep them covered by `npm run
check:agent-corpus`.
