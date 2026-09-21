import { readdir, stat, unlink, rm } from 'fs/promises';
import { join, normalize } from 'path';
import { homedir } from 'os';
import {
  deleteCodexSession,
  filterCodexSessionsByProject,
  listCodexSessions,
} from './codex-storage.ts';
import type { Session, AgentId } from '../shared/types.ts';
import {
  isMissingSessionFile,
  readClaudeSessionMeta,
  readCopilotSessionMeta,
  readGeminiSessionMeta,
} from './session-metadata.ts';
import { preferences } from './preferences-store.ts';
import { applySessionNames } from '../shared/session-presentation.ts';

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');
const COPILOT_SESSION_STATE_ROOT = join(homedir(), '.copilot', 'session-state');

function normalizeProjectPath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

async function resolveHistoryProjectId(projectId: string): Promise<string | null> {
  if (!projectId.includes(':manual:')) return projectId;
  const projects = await import('./projects.ts');
  return projects.resolveHistoryProjectId(projectId);
}

async function readSessionDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isMissingSessionFile(error)) return [];
    throw error;
  }
}

async function listClaudeSessions(projectId: string, dirName: string): Promise<Session[]> {
  const dir = join(CLAUDE_ROOT, dirName);
  const files = await readSessionDirectory(dir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(dir, f);
    const id = f.replace(/\.jsonl$/, '');
    const meta = await readClaudeSessionMeta(full);
    if (!meta) continue;
    out.push({
      id,
      projectId,
      agent: 'claude',
      ...meta,
    });
  }
  return out;
}

async function listGeminiSessions(projectId: string, dirName: string): Promise<Session[]> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  const out: Session[] = [];
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full);
    if (!meta?.sessionId) continue;
    out.push({
      id: meta.sessionId,
      projectId,
      agent: 'gemini',
      title: meta.title,
      timestamp: meta.timestamp,
      cwd: null,
      gitBranch: null,
      version: null,
    });
  }
  return out;
}

async function listCopilotSessions(projectId: string, projectPath: string): Promise<Session[]> {
  const entries = await readSessionDirectory(COPILOT_SESSION_STATE_ROOT);
  const targetPath = normalizeProjectPath(projectPath);
  const out: Session[] = [];
  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    try {
      if (!(await stat(sessionDir)).isDirectory()) continue;
    } catch (error) {
      if (isMissingSessionFile(error)) continue;
      throw error;
    }

    const meta = await readCopilotSessionMeta(join(sessionDir, 'events.jsonl'));
    if (!meta) continue;
    if (normalizeProjectPath(meta.projectPath) !== targetPath) continue;
    out.push({
      id: meta.sessionId ?? dirName,
      projectId,
      agent: 'copilot',
      title: meta.title,
      timestamp: meta.timestamp,
      cwd: meta.cwd,
      gitBranch: meta.gitBranch,
      version: meta.version,
    });
  }
  return out;
}

export async function listSessionsForProject(projectId: string): Promise<Session[]> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) return [];
  if (historyId !== projectId) {
    return (await listSessionsForProject(historyId)).map((s) => ({ ...s, projectId }));
  }
  const colon = projectId.indexOf(':');
  if (colon < 0) return [];
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  let out: Session[] = [];
  if (agent === 'claude') out = await listClaudeSessions(projectId, dirName);
  else if (agent === 'codex') {
    out = filterCodexSessionsByProject(await listCodexSessions(), dirName).map((session) => ({
      id: session.id,
      projectId,
      agent: 'codex',
      title: session.title,
      timestamp: session.timestamp,
      cwd: session.cwd,
      gitBranch: null,
      version: session.version,
    }));
  } else if (agent === 'gemini') out = await listGeminiSessions(projectId, dirName);
  else if (agent === 'copilot') out = await listCopilotSessions(projectId, dirName);
  // aider: no session listing in v1

  out.sort((a, b) => b.timestamp - a.timestamp);
  return applySessionNames(out, (await preferences.read()).sessionNames);
}

export async function renameSession(
  projectId: string,
  sessionId: string,
  title: string,
): Promise<string> {
  const session = (await listSessionsForProject(projectId)).find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return preferences.renameSession(session.agent, session.id, title);
}

async function findGeminiSessionFile(dirName: string, sessionId: string): Promise<string | null> {
  const chatsDir = join(GEMINI_TMP_ROOT, dirName, 'chats');
  const files = await readSessionDirectory(chatsDir);
  for (const f of files.filter((x) => x.endsWith('.jsonl'))) {
    const full = join(chatsDir, f);
    const meta = await readGeminiSessionMeta(full);
    if (meta?.sessionId === sessionId) return full;
  }
  return null;
}

export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  const historyId = await resolveHistoryProjectId(projectId);
  if (!historyId) throw new Error(`Session not found: ${sessionId}`);
  if (historyId !== projectId) return deleteSession(historyId, sessionId);
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await unlink(join(CLAUDE_ROOT, dirName, `${sessionId}.jsonl`));
  } else if (agent === 'codex') {
    await deleteCodexSession(sessionId);
  } else if (agent === 'gemini') {
    const file = await findGeminiSessionFile(dirName, sessionId);
    if (!file) throw new Error(`Session not found: ${sessionId}`);
    await unlink(file);
  } else if (agent === 'copilot') {
    await rm(join(COPILOT_SESSION_STATE_ROOT, sessionId), { recursive: true, force: true });
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }
}
