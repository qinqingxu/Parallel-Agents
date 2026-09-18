# Agentic workflow dashboard

This dashboard describes where to inspect the latest agentic validation and recovery signals.
It does not replace the underlying GitHub workflow runs, validation receipts, or source-bound
evidence envelopes.

| Signal               | Source                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Required validation  | GitHub `Validate` workflow and `reports/validation` artifacts                                |
| Maintenance recovery | GitHub `Maintenance recovery verification` workflow and `reports/maintenance-loop` artifacts |
| Documentation drift  | GitHub `Documentation contracts` workflow                                                    |
| Security evidence    | GitHub `Security checks` workflow and redacted `reports/security` artifacts                  |
| Copilot PR review    | GitHub `Recurring Copilot review` workflow output for the whole diff with scoped guards      |

Use this as a navigation page only; the individual run logs and receipts remain the evidence.
