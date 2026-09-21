import { createReadStream } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join, normalize } from 'path';
import { createInterface } from 'readline';

const DEFAULT_CODEX_ROOT = join(homedir(), '.codex');
const TITLE_MAX = 80;

export interface CodexStoredSession {
  id: string;
  cwd: string;
  title: string;
  timestamp: number;
  version: string | null;
  filePath: string;
}

export interface CodexProjectGroup {
  realPath: string;
  sessionCount: number;
  lastActivity: number;
}

interface CodexSessionIndexEntry {
  title: string;
  timestamp: number | null;
}

interface ParsedRollout {
  id: string;
  cwd: string;
  fallbackTitle: string | null;
  timestamp: number;
  version: string | null;
  filePath: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function trimTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ');
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX)}...` : title;
}

function firstUserTitle(payload: Record<string, unknown>): string | null {
  if (payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) {
    return null;
  }
  for (const item of payload.content) {
    const content = asRecord(item);
    if (content?.type !== 'input_text' || typeof content.text !== 'string') continue;
    const title = trimTitle(content.text);
    if (title) return title;
  }
  return null;
}

async function findRolloutFiles(sessionsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(sessionsRoot, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await findRolloutFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }),
  );
  return files;
}

async function readSessionIndex(codexRoot: string): Promise<Map<string, CodexSessionIndexEntry>> {
  const entries = new Map<string, CodexSessionIndexEntry>();
  const stream = createReadStream(join(codexRoot, 'session_index.jsonl'), { encoding: 'utf-8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = asRecord(JSON.parse(line));
        if (!record || typeof record.id !== 'string' || typeof record.thread_name !== 'string') {
          continue;
        }
        const title = trimTitle(record.thread_name);
        if (!title) continue;
        entries.set(record.id, {
          title,
          timestamp: parseTimestamp(record.updated_at),
        });
      } catch {
        // A malformed index entry must not hide other sessions.
      }
    }
  } catch {
    return entries;
  }
  return entries;
}

async function readRollout(filePath: string): Promise<ParsedRollout | null> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let metadata: Omit<ParsedRollout, 'fallbackTitle'> | null = null;
  let fallbackTitle: string | null = null;

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record: Record<string, unknown> | null;
      try {
        record = asRecord(JSON.parse(line));
      } catch {
        continue;
      }
      if (!record) continue;
      const payload = asRecord(record.payload);
      if (!payload) continue;

      if (!metadata && record.type === 'session_meta') {
        const id =
          typeof payload.id === 'string'
            ? payload.id
            : typeof payload.session_id === 'string'
              ? payload.session_id
              : null;
        if (!id || typeof payload.cwd !== 'string' || !payload.cwd) continue;
        let fallbackTimestamp = 0;
        try {
          fallbackTimestamp = (await stat(filePath)).mtimeMs;
        } catch {
          // Keep zero when the file disappears during a refresh.
        }
        metadata = {
          id,
          cwd: normalize(payload.cwd),
          timestamp:
            parseTimestamp(payload.timestamp) ??
            parseTimestamp(record.timestamp) ??
            fallbackTimestamp,
          version: typeof payload.cli_version === 'string' ? payload.cli_version : null,
          filePath,
        };
      } else if (!fallbackTitle && record.type === 'response_item') {
        fallbackTitle = firstUserTitle(payload);
      }
      if (metadata && fallbackTitle) break;
    }
  } catch {
    return null;
  }

  return metadata ? { ...metadata, fallbackTitle } : null;
}

export function normalizeCodexProjectPath(path: string): string {
  const normalized = normalize(path);
  return process.platform === 'win32' || /^[a-zA-Z]:[\\/]/.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

export async function listCodexSessions(
  codexRoot: string = DEFAULT_CODEX_ROOT,
): Promise<CodexStoredSession[]> {
  const [files, index] = await Promise.all([
    findRolloutFiles(join(codexRoot, 'sessions')),
    readSessionIndex(codexRoot),
  ]);
  const parsed: Array<ParsedRollout | null> = [];
  for (let i = 0; i < files.length; i += 16) {
    parsed.push(...(await Promise.all(files.slice(i, i + 16).map(readRollout))));
  }
  const sessions = parsed.flatMap((session) => {
    if (!session) return [];
    const indexed = index.get(session.id);
    return [
      {
        id: session.id,
        cwd: session.cwd,
        title: indexed?.title ?? session.fallbackTitle ?? '(no user message)',
        timestamp: indexed?.timestamp ?? session.timestamp,
        version: session.version,
        filePath: session.filePath,
      },
    ];
  });
  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}

export function groupCodexSessionsByProject(sessions: CodexStoredSession[]): CodexProjectGroup[] {
  const groups = new Map<string, CodexProjectGroup>();
  for (const session of sessions) {
    const key = normalizeCodexProjectPath(session.cwd);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        realPath: session.cwd,
        sessionCount: 1,
        lastActivity: session.timestamp,
      });
      continue;
    }
    existing.sessionCount += 1;
    existing.lastActivity = Math.max(existing.lastActivity, session.timestamp);
  }
  return [...groups.values()];
}

export function filterCodexSessionsByProject(
  sessions: CodexStoredSession[],
  projectPath: string,
): CodexStoredSession[] {
  const target = normalizeCodexProjectPath(projectPath);
  return sessions.filter((session) => normalizeCodexProjectPath(session.cwd) === target);
}

export async function deleteCodexSession(
  sessionId: string,
  codexRoot: string = DEFAULT_CODEX_ROOT,
): Promise<void> {
  const session = (await listCodexSessions(codexRoot)).find((item) => item.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  await unlink(session.filePath);
}

export async function deleteCodexProject(
  projectPath: string,
  codexRoot: string = DEFAULT_CODEX_ROOT,
): Promise<void> {
  const target = normalizeCodexProjectPath(projectPath);
  const sessions = await listCodexSessions(codexRoot);
  await Promise.all(
    sessions
      .filter((session) => normalizeCodexProjectPath(session.cwd) === target)
      .map((session) => unlink(session.filePath)),
  );
}
