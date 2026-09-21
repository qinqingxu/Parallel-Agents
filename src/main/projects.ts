import { readdir, stat, readFile, rm } from 'fs/promises';
import { join, normalize, isAbsolute } from 'path';
import { homedir } from 'os';
import { loadConfig, forgetProject } from './config.ts';
import { readCopilotSessionStart } from './session-metadata.ts';
import {
  deleteCodexProject,
  groupCodexSessionsByProject,
  listCodexSessions,
} from './codex-storage.ts';
import {
  removeProjectsFromSnapshot,
  stabilizeCopilotProjects,
  validateMissingProjectIds,
  type CopilotScanResult,
} from './project-policies.ts';
import type { Project, AgentId } from '../shared/types.ts';
import type { NewProjectOptions } from '../shared/types.ts';
import { preferences } from './preferences-store.ts';
import { createProjectWorktree, findProjectRepositoryRoot } from './worktrees.ts';
import { AGENT_IDS } from './agent-providers.ts';

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects');
const GEMINI_TMP_ROOT = join(homedir(), '.gemini', 'tmp');
const COPILOT_SESSION_STATE_ROOT = join(homedir(), '.copilot', 'session-state');
let lastSuccessfulCopilotProjects: Project[] = [];

// C--jelllove-ParallelAgents   →  C:\jelllove\ParallelAgents
// c--Users-jelllove            →  c:\Users\jelllove
// Naive fallback: every `-` becomes `\`. Loses real `.` in folder names
// (Claude encodes `.` as `-` too — so `Mr.Translator` becomes `Mr-Translator`).
// Prefer `decodeDirNameFromJsonl` below when possible.
export function decodeDirName(name: string): string {
  const m = name.match(/^([a-zA-Z])--(.*)$/);
  if (!m) return name.replaceAll('-', '\\');
  const drive = m[1];
  const rest = m[2].replaceAll('-', '\\');
  return `${drive}:\\${rest}`;
}

// Claude logs the real `cwd` in every jsonl line. Read the first line of any
// session file in `projectDir` and return that as ground truth.
async function decodeDirNameFromJsonl(projectDir: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(projectDir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    try {
      const content = await readFile(join(projectDir, f), 'utf-8');
      const nl = content.indexOf('\n');
      const firstLine = nl >= 0 ? content.slice(0, nl) : content;
      if (!firstLine.trim()) continue;
      const obj = JSON.parse(firstLine);
      if (typeof obj?.cwd === 'string' && obj.cwd) return obj.cwd;
      // Some early lines (e.g. permission-mode) lack cwd. Probe a few more.
      for (const line of content.split('\n').slice(0, 20)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (typeof o?.cwd === 'string' && o.cwd) return o.cwd;
        } catch {}
      }
    } catch {}
  }
  return null;
}

export function displayNameFor(realPath: string): string {
  const parts = realPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || realPath;
}

export function makeProjectId(agent: AgentId, dirName: string): string {
  return `${agent}:${dirName}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function normalizeProjectPath(p: string): string {
  const n = normalize(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

async function listClaudeProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  let entries: string[];
  try {
    entries = await readdir(CLAUDE_ROOT);
  } catch {
    return [];
  }

  const out: Project[] = [];
  for (const dirName of entries) {
    const full = join(CLAUDE_ROOT, dirName);
    try {
      if (!(await stat(full)).isDirectory()) continue;
    } catch {
      continue;
    }

    const realPath = (await decodeDirNameFromJsonl(full)) ?? decodeDirName(dirName);
    const exists = await pathExists(realPath);
    const id = makeProjectId('claude', dirName);

    let sessionCount = 0;
    let lastActivity: number | null = null;
    try {
      const files = await readdir(full);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        sessionCount++;
        try {
          const s = await stat(join(full, f));
          if (lastActivity === null || s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
        } catch {}
      }
    } catch {}

    out.push({
      id,
      agent: 'claude',
      dirName,
      realPath,
      displayName: displayNameFor(realPath),
      exists,
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount,
      lastActivity,
    });
  }
  return out;
}

async function listGeminiProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  let entries: string[];
  try {
    entries = await readdir(GEMINI_TMP_ROOT);
  } catch {
    return [];
  }

  const out: Project[] = [];
  for (const dirName of entries) {
    const full = join(GEMINI_TMP_ROOT, dirName);
    try {
      if (!(await stat(full)).isDirectory()) continue;
    } catch {
      continue;
    }

    let realPath: string;
    try {
      realPath = (await readFile(join(full, '.project_root'), 'utf-8')).trim();
    } catch {
      continue; // no .project_root → not a usable Gemini project
    }
    if (!realPath) continue;

    const exists = await pathExists(realPath);
    const id = makeProjectId('gemini', dirName);

    let sessionCount = 0;
    let lastActivity: number | null = null;
    try {
      const chatFiles = await readdir(join(full, 'chats'));
      for (const f of chatFiles) {
        if (!f.endsWith('.jsonl')) continue;
        sessionCount++;
        try {
          const s = await stat(join(full, 'chats', f));
          if (lastActivity === null || s.mtimeMs > lastActivity) lastActivity = s.mtimeMs;
        } catch {}
      }
    } catch {}

    out.push({
      id,
      agent: 'gemini',
      dirName,
      realPath,
      displayName: displayNameFor(realPath),
      exists,
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount,
      lastActivity,
    });
  }
  return out;
}

async function listCopilotProjects(
  pinned: Set<string>,
  hidden: Set<string>,
): Promise<CopilotScanResult> {
  let entries: string[];
  try {
    entries = await readdir(COPILOT_SESSION_STATE_ROOT);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { projects: [], valid: missing, candidateCount: 0, parsedCount: 0 };
  }
  let candidateCount = 0;
  let parsedCount = 0;

  const grouped = new Map<
    string,
    {
      realPath: string;
      sessionCount: number;
      lastActivity: number | null;
    }
  >();

  for (const dirName of entries) {
    const sessionDir = join(COPILOT_SESSION_STATE_ROOT, dirName);
    try {
      if (!(await stat(sessionDir)).isDirectory()) continue;
    } catch {
      continue;
    }

    const eventsPath = join(sessionDir, 'events.jsonl');
    let mtimeMs: number;
    try {
      const s = await stat(eventsPath);
      if (!s.isFile()) continue;
      mtimeMs = s.mtimeMs;
    } catch {
      continue;
    }
    candidateCount++;

    const meta = await readCopilotSessionStart(eventsPath);
    if (!meta) continue;
    parsedCount++;

    const key = normalizeProjectPath(meta.projectPath);
    const existing = grouped.get(key);
    const activityTs = Number.isFinite(mtimeMs) ? mtimeMs : meta.timestamp;
    if (!existing) {
      grouped.set(key, {
        realPath: meta.projectPath,
        sessionCount: 1,
        lastActivity: activityTs || null,
      });
      continue;
    }

    existing.sessionCount += 1;
    if (activityTs && (existing.lastActivity === null || activityTs > existing.lastActivity)) {
      existing.lastActivity = activityTs;
    }
  }

  const out: Project[] = [];
  for (const agg of grouped.values()) {
    const dirName = agg.realPath;
    const id = makeProjectId('copilot', dirName);
    out.push({
      id,
      agent: 'copilot',
      dirName,
      realPath: agg.realPath,
      displayName: displayNameFor(agg.realPath),
      exists: await pathExists(agg.realPath),
      pinned: pinned.has(id),
      hidden: hidden.has(id),
      sessionCount: agg.sessionCount,
      lastActivity: agg.lastActivity,
    });
  }
  return { projects: out, valid: true, candidateCount, parsedCount };
}

async function listCodexProjects(pinned: Set<string>, hidden: Set<string>): Promise<Project[]> {
  const groups = groupCodexSessionsByProject(await listCodexSessions());
  return Promise.all(
    groups.map(async (group) => {
      const id = makeProjectId('codex', group.realPath);
      return {
        id,
        agent: 'codex',
        dirName: group.realPath,
        realPath: group.realPath,
        displayName: displayNameFor(group.realPath),
        exists: await pathExists(group.realPath),
        pinned: pinned.has(id),
        hidden: hidden.has(id),
        sessionCount: group.sessionCount,
        lastActivity: group.lastActivity,
      };
    }),
  );
}

async function listDiscoveredProjects(): Promise<Project[]> {
  const cfg = await loadConfig();
  const pinned = new Set(cfg.pinned);
  const hidden = new Set(cfg.hidden);

  const [claude, codex, gemini, copilotScan] = await Promise.all([
    listClaudeProjects(pinned, hidden),
    listCodexProjects(pinned, hidden),
    listGeminiProjects(pinned, hidden),
    listCopilotProjects(pinned, hidden),
  ]);
  const stabilizedCopilot = stabilizeCopilotProjects(lastSuccessfulCopilotProjects, copilotScan);
  if (copilotScan.valid && (copilotScan.candidateCount === 0 || copilotScan.parsedCount > 0)) {
    lastSuccessfulCopilotProjects = stabilizedCopilot;
  }
  const copilot = stabilizedCopilot.map((project) => ({
    ...project,
    pinned: pinned.has(project.id),
    hidden: hidden.has(project.id),
  }));

  const out = [...claude, ...codex, ...gemini, ...copilot];
  const orderIndex = (p: Project): number => {
    const ids = cfg.projectOrder?.[p.agent] ?? [];
    const i = ids.indexOf(p.id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.agent === b.agent) {
      const ai = orderIndex(a);
      const bi = orderIndex(b);
      if (ai !== bi) return ai - bi;
    }
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  });
  return out;
}

export async function listProjects(): Promise<Project[]> {
  const [discovered, stored, cfg] = await Promise.all([
    listDiscoveredProjects(),
    preferences.read(),
    loadConfig(),
  ]);
  const out = [...discovered];
  for (const registered of stored.projects) {
    const match = discovered.find(
      (project) =>
        project.agent === registered.agent &&
        normalizeProjectPath(project.realPath) ===
          normalizeProjectPath(registered.historyPath ?? registered.realPath),
    );
    if (match) {
      const project = {
        ...match,
        id: registered.id,
        realPath: registered.realPath,
        historyProjectId: match.id,
        displayName: displayNameFor(registered.realPath),
        exists: await pathExists(registered.realPath),
        pinned: cfg.pinned.includes(registered.id),
        hidden: cfg.hidden.includes(registered.id),
      };
      const index = out.findIndex((p) => p.id === match.id);
      if (index >= 0) out.splice(index, 1, project);
      else out.push(project);
      continue;
    }
    out.push({
      ...registered,
      dirName: `manual:${registered.realPath}`,
      displayName: displayNameFor(registered.realPath),
      exists: await pathExists(registered.realPath),
      pinned: cfg.pinned.includes(registered.id),
      hidden: cfg.hidden.includes(registered.id),
      sessionCount: 0,
      lastActivity: null,
    });
  }
  return out.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.agent === b.agent) {
      const order = cfg.projectOrder[a.agent] ?? [];
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai !== bi) return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
    }
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  });
}

export async function createProject(options: NewProjectOptions): Promise<Project> {
  if (!options || !AGENT_IDS.includes(options.agent)) throw new Error('Choose a valid agent.');
  if (options.mode !== 'folder' && options.mode !== 'worktree')
    throw new Error('Invalid project mode.');
  if (
    typeof options.basePath !== 'string' ||
    !isAbsolute(options.basePath) ||
    !(await pathExists(options.basePath))
  ) {
    throw new Error('Choose an existing absolute project folder.');
  }
  const realPath =
    options.mode === 'worktree'
      ? await createProjectWorktree({
          basePath: options.basePath,
          branch: options.branch ?? '',
          startPoint: options.startPoint || 'HEAD',
          targetPath: options.targetPath ?? '',
        })
      : normalize(options.basePath);
  const existing = (await listProjects()).find(
    (project) =>
      project.agent === options.agent &&
      normalizeProjectPath(project.realPath) === normalizeProjectPath(realPath),
  );
  const id = existing?.id ?? `${options.agent}:manual:${normalizeProjectPath(realPath)}`;
  const historyPath =
    options.agent === 'copilot'
      ? ((await findProjectRepositoryRoot(realPath)) ?? realPath)
      : realPath;
  try {
    await preferences.registerProject({ id, agent: options.agent, realPath, historyPath });
  } catch (error) {
    throw new Error(
      `Folder is ready at "${realPath}", but saving the project failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return (
    existing ?? {
      id,
      agent: options.agent,
      realPath,
      dirName: `manual:${realPath}`,
      displayName: displayNameFor(realPath),
      exists: true,
      pinned: false,
      hidden: false,
      sessionCount: 0,
      lastActivity: null,
    }
  );
}

export async function resolveHistoryProjectId(projectId: string): Promise<string | null> {
  const registered = (await preferences.read()).projects.find((p) => p.id === projectId);
  if (!registered && projectId.includes(':manual:'))
    throw new Error(`Unknown registered project: ${projectId}`);
  if (!registered || !projectId.includes(':manual:')) return projectId;
  return (
    (await listDiscoveredProjects()).find(
      (project) =>
        project.agent === registered.agent &&
        normalizeProjectPath(project.realPath) ===
          normalizeProjectPath(registered.historyPath ?? registered.realPath),
    )?.id ?? null
  );
}

async function deleteProjectHistory(projectId: string): Promise<void> {
  const registered = (await preferences.read()).projects.find((p) => p.id === projectId);
  if (
    registered?.agent === 'copilot' &&
    registered.historyPath &&
    normalizeProjectPath(registered.realPath) !== normalizeProjectPath(registered.historyPath)
  ) {
    // Subfolder registrations share repository history with other workspaces.
    return;
  }
  if (projectId.includes(':manual:')) {
    const historyId = await resolveHistoryProjectId(projectId);
    if (historyId) await deleteProjectHistory(historyId);
    return;
  }
  const colon = projectId.indexOf(':');
  if (colon < 0) throw new Error(`Invalid projectId: ${projectId}`);
  const agent = projectId.slice(0, colon) as AgentId;
  const dirName = projectId.slice(colon + 1);

  if (agent === 'claude') {
    await rm(join(CLAUDE_ROOT, dirName), { recursive: true, force: true });
  } else if (agent === 'codex') {
    await deleteCodexProject(dirName);
  } else if (agent === 'gemini') {
    await rm(join(GEMINI_TMP_ROOT, dirName), { recursive: true, force: true });
  } else if (agent === 'copilot') {
    const target = normalizeProjectPath(dirName);
    let entries: string[];
    try {
      entries = await readdir(COPILOT_SESSION_STATE_ROOT);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      entries = [];
    }
    for (const sessionDirName of entries) {
      const sessionDir = join(COPILOT_SESSION_STATE_ROOT, sessionDirName);
      try {
        if (!(await stat(sessionDir)).isDirectory()) continue;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
      const eventsPath = join(sessionDir, 'events.jsonl');
      const meta = await readCopilotSessionStart(eventsPath);
      if (!meta) continue;
      if (normalizeProjectPath(meta.projectPath) !== target) continue;
      await rm(sessionDir, { recursive: true, force: true });
    }
  } else {
    throw new Error(`Delete not supported for agent: ${agent}`);
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  await deleteProjectHistory(projectId);
  lastSuccessfulCopilotProjects = removeProjectsFromSnapshot(lastSuccessfulCopilotProjects, [
    projectId,
  ]);
  await forgetProject(projectId);
  await preferences.forgetProject(projectId);
}

export async function deleteMissingProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) throw new Error('No projects selected');
  const targets = validateMissingProjectIds(await listProjects(), projectIds);
  for (const project of targets) {
    if (await pathExists(project.realPath)) {
      throw new Error(`Project is not missing: ${project.id}`);
    }
  }
  for (const project of targets) {
    await deleteProjectHistory(project.id);
    lastSuccessfulCopilotProjects = removeProjectsFromSnapshot(lastSuccessfulCopilotProjects, [
      project.id,
    ]);
    await forgetProject(project.id);
    await preferences.forgetProject(project.id);
  }
}
