---
description: Diagnose a failing Parallel Agents validation signal and prepare a guarded repair plan.
mode: agent
---

# Validation repair prompt

Use this prompt only from a trusted checkout of Parallel Agents. Follow
[AGENTS.md](../../AGENTS.md), [.github/instructions/tooling.instructions.md](../instructions/tooling.instructions.md),
and the requested validation surface before making changes.

## Inputs

- The failing command, workflow job, or reviewer finding.
- The smallest reproduced failure output that includes the command and exit code.
- The intended scope: documentation-only, engineering automation, native smoke, or application code.

## Procedure

1. Reproduce the exact failure with the smallest local command that covers it.
2. Read [.github/agent-rules/learned-rules.json](../agent-rules/learned-rules.json), consume only
   rules with `state: "active"`, and ignore candidate or retired rules.
3. Identify whether the failure is caused by the current candidate, existing baseline state, or
   external infrastructure. Do not turn an external outage into a passing receipt.
4. Make the smallest behavior-preserving repair that fits the reported scope.
5. Re-run the failing command and any directly coupled checks.
6. Report the command, outcome, changed files, remaining risk, and whether release or provider access
   was avoided.

## Guardrails

- Do not run release, publish, merge, push, destructive Git, or provider-login commands unless the user explicitly
  requests them.
- Do not read or rewrite real provider histories, home credentials, or ignored local data.
- Preserve concurrent user edits and fail visibly rather than masking malformed inputs.
