# Codex Project and Session Visibility Design

## Goal

Make existing Codex CLI projects and sessions visible in Parallel Agents by reading Codex's persisted session data under `~/.codex/`.

## Storage Model

Codex stores rollout files below:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

The `session_meta` record contains the stable session ID, working directory, creation timestamp, and CLI version. `~/.codex/session_index.jsonl` maps session IDs to user-facing thread names and update timestamps.

## Architecture

Add a focused Codex storage module in the main process. It will:

- recursively discover rollout JSONL files;
- parse session metadata without loading entire files into memory;
- read the session index for display titles;
- normalize working-directory paths for project grouping;
- expose one session inventory used by both project and session APIs;
- locate rollout files for session and project deletion.

`projects.ts` will group the inventory by normalized working directory and create `codex:<cwd>` projects. `sessions.ts` will filter the same inventory by project path and map it to the shared `Session` type.

## Data Flow

1. Project refresh scans Codex rollout files.
2. Valid sessions are grouped by `cwd`.
3. Each group produces a Codex project with session count and latest activity.
4. Selecting a Codex project filters sessions by normalized `cwd`.
5. Selecting a session resumes it with the existing `codex resume <sessionId>` command.

Titles prefer `session_index.jsonl` thread names. If an index entry is absent, the scanner uses the first user message; if neither exists, it uses a neutral fallback.

## Deletion

Deleting a Codex session removes its matching rollout file. Deleting a Codex project removes all rollout files whose session metadata belongs to that project. Existing config cleanup remains unchanged.

The scanner treats rollout files as the source of truth, so stale session-index entries do not create phantom sessions or projects.

## Error Handling

- A missing Codex root or sessions directory produces an empty inventory.
- An unreadable or malformed rollout file is skipped without preventing other sessions from loading.
- Unsupported or invalid project IDs continue to surface errors according to existing API behavior.
- Deletion throws when a requested Codex session cannot be found instead of reporting false success.

## Testing

Add targeted tests for:

- recursive rollout discovery;
- project grouping using normalized paths;
- session title lookup and fallback behavior;
- timestamp ordering and session counts;
- malformed JSONL isolation;
- session and project deletion targeting.

Run the existing test suite and production build after implementation.
