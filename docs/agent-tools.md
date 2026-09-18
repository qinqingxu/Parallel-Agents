# Bounded local engineering tools

[The stdio MCP server](../scripts/mcp-server.mjs) exposes the repository's existing engineering
helpers to MCP-capable clients. It is separate from the Electron application and uses no provider
credentials, network listener, arbitrary command endpoint, or new runtime dependency.

## Start and configure

From a trusted repository checkout with its documented dependencies:

```powershell
node scripts/mcp-server.mjs
```

For clients, use the [VS Code configuration](../.vscode/mcp.json) or
[project MCP configuration](../.mcp.json). The latter assumes the client starts in the repository
root. Approve/configure the server in your client explicitly; these files do not disable client
trust prompts or automatically start a provider session.

Protocol stdout contains JSON-RPC messages only. Use the direct Node command or a silent npm
invocation, not a banner-producing npm wrapper when configuring stdio transport.
The server implements MCP `2025-06-18` only. A client requesting another version is offered that
version and must decide whether it supports it; legacy batch semantics are not advertised.

## Tools and boundaries

| Tool                  | Capability                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `repository_doctor`   | Inspect Node/npm/Git, setup contract, and active learned rules; never install               |
| `maintenance_preview` | Read-only bounded formatting inspection; no apply option                                    |
| `run_validation`      | Run one of `docs`, `format`, `lint`, `types`, or `unit`, with the existing fixed npm script |
| `verify_evidence`     | Check a source-bound evidence envelope and its constrained artifact hashes                  |

No tool accepts a shell command, external root, environment override, arbitrary file path,
publication request, or maintenance mutation. The server does not expose package installation,
native application launch, release, push, merge, or hook installation.

Validation executes trusted repository scripts, not sandboxed untrusted code. Unit tests create
disposable fixtures and local report artifacts, so that tool is not labeled read-only. Only one
tool call can run at once, execution/output are bounded, and 64 KiB request limits plus stdout
backpressure prevent unbounded transport queues.

Each fixed validation records its actual exit/status and source-bound evidence under a new
`reports/agent-validation` run directory. Failure is returned with `isError: true`, not converted
to a passing result. The user can run the documented command directly for full diagnostics;
subprocess environment values and raw logs are not copied into tool responses.

Content binding is not independent proof of execution. See the
[evidence protocol](specs/evidence-v1.md). The server, protocol, malformed input, slow clients,
fixed-command execution, and failure paths are exercised by
[the protocol tests](../tests/mcp-server.test.mjs).

The doctor tool consumes only active entries from the
[learned-rule corpus](../.github/agent-rules/learned-rules.json). Candidate and retired rules remain
validated by `npm run check:agent-corpus` but are not returned to later agent runs.
