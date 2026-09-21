import { mkdir, readFile, rename, writeFile, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { validateSessionName } from '../shared/session-presentation.ts';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  validateFontFamily,
  validateFontSize,
  type FontFamilyId,
} from '../shared/typography.ts';
import type { AgentId, RegisteredProject } from '../shared/types.ts';

interface Preferences {
  sessionNames: Record<string, string>;
  fontSize: number;
  fontFamily: FontFamilyId;
  fontBold: boolean;
  projects: RegisteredProject[];
}

const agentIds = new Set<AgentId>(['claude', 'codex', 'gemini', 'aider', 'copilot']);

function validateRegisteredProject(value: unknown): RegisteredProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid registered project.');
  }
  const project = value as Partial<RegisteredProject>;
  if (
    typeof project.id !== 'string' ||
    !project.id ||
    typeof project.realPath !== 'string' ||
    !project.realPath ||
    typeof project.agent !== 'string' ||
    !agentIds.has(project.agent)
  ) {
    throw new Error('Invalid registered project.');
  }
  if (project.historyPath !== undefined && typeof project.historyPath !== 'string') {
    throw new Error('Invalid registered project.');
  }
  return {
    id: project.id,
    agent: project.agent,
    realPath: project.realPath,
    ...(project.historyPath ? { historyPath: project.historyPath } : {}),
  };
}

export class PreferencesStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<Preferences> {
    await this.pending;
    return this.readDisk();
  }

  private async readDisk(): Promise<Preferences> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {
        sessionNames: {},
        fontSize: DEFAULT_FONT_SIZE,
        fontFamily: DEFAULT_FONT_FAMILY,
        fontBold: false,
        projects: [],
      };
    }
    const data: Preferences = JSON.parse(text);
    if (
      !data ||
      !data.sessionNames ||
      typeof data.sessionNames !== 'object' ||
      Array.isArray(data.sessionNames) ||
      !Array.isArray(data.projects)
    ) {
      throw new Error('Invalid application preferences.');
    }
    validateFontSize(data.fontSize);
    if (!Object.hasOwn(data, 'fontFamily')) data.fontFamily = DEFAULT_FONT_FAMILY;
    data.fontFamily = validateFontFamily(data.fontFamily);
    if (!Object.hasOwn(data, 'fontBold')) data.fontBold = false;
    if (typeof data.fontBold !== 'boolean') throw new Error('Font bold must be a boolean.');
    for (const name of Object.values(data.sessionNames)) validateSessionName(name);
    return { ...data, projects: data.projects.map(validateRegisteredProject) };
  }

  private update(change: (data: Preferences) => Preferences): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = change(await this.readDisk());
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), 'utf-8');
        await rename(temporary, this.path);
      } catch (error) {
        await unlink(temporary).catch((cleanup: NodeJS.ErrnoException) => {
          if (cleanup.code !== 'ENOENT') console.error('Preferences cleanup failed:', cleanup);
        });
        throw error;
      }
    });
    // Failed writes reject their caller but must not poison subsequent updates.
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async renameSession(agent: AgentId, id: string, title: string): Promise<string> {
    const name = validateSessionName(title);
    if (!id) throw new Error('Session ID is required.');
    await this.update((data) => ({
      ...data,
      sessionNames: { ...data.sessionNames, [`${agent}:${id}`]: name },
    }));
    return name;
  }

  async setFontSize(size: number): Promise<void> {
    validateFontSize(size);
    await this.update((data) => ({ ...data, fontSize: size }));
  }

  async setFontFamily(fontFamily: string): Promise<void> {
    const next = validateFontFamily(fontFamily);
    await this.update((data) => ({ ...data, fontFamily: next }));
  }

  async setFontBold(bold: boolean): Promise<void> {
    if (typeof bold !== 'boolean') throw new Error('Font bold must be a boolean.');
    await this.update((data) => ({ ...data, fontBold: bold }));
  }

  registerProject(project: RegisteredProject): Promise<void> {
    const registered = validateRegisteredProject(project);
    return this.update((data) => ({
      ...data,
      projects: [...data.projects.filter((p) => p.id !== registered.id), registered],
    }));
  }

  forgetProject(id: string): Promise<void> {
    return this.update((data) => ({ ...data, projects: data.projects.filter((p) => p.id !== id) }));
  }
}

export const preferences = new PreferencesStore(
  join(homedir(), '.claude', 'parallel-agents-preferences.json'),
);
