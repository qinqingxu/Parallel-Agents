import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentId, AppConfig, LayoutConfig, ThemeMode } from '../shared/types.ts';
import {
  agentId,
  booleanSetting,
  defaultConfig,
  layoutSetting,
  migrateConfig,
  projectId,
  projectIds,
  themeSetting,
  validateConfig,
} from './config-schema.ts';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createConfigStore(configPath: string) {
  let cache: AppConfig | null = null;
  let queue = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function persist(config: AppConfig): Promise<void> {
    const stagingPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(configPath), { recursive: true });
      let written = false;
      try {
        await writeFile(stagingPath, JSON.stringify(config, null, 2), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        written = true;
        await rename(stagingPath, configPath);
      } catch (error) {
        // An exclusive-open collision must not remove another writer's file.
        if (written || !hasCode(error, 'EEXIST')) {
          try {
            await unlink(stagingPath);
          } catch (cleanupError) {
            if (!hasCode(cleanupError, 'ENOENT')) {
              throw new AggregateError(
                [error, cleanupError],
                `${message(error)}; staging-file cleanup failed: ${message(cleanupError)}`,
                { cause: cleanupError },
              );
            }
          }
        }
        throw error;
      }
    } catch (error) {
      throw new Error(`Failed to save configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
  }

  async function readCurrent(): Promise<AppConfig> {
    if (cache) return cache;
    let text: string;
    try {
      text = await readFile(configPath, 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        cache = defaultConfig();
        return cache;
      }
      throw new Error(`Failed to read configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
    let migrated: ReturnType<typeof migrateConfig>;
    try {
      const parsed: unknown = JSON.parse(text);
      migrated = migrateConfig(validateConfig(parsed));
    } catch (error) {
      throw new Error(`Invalid configuration at ${configPath}: ${message(error)}`, {
        cause: error,
      });
    }
    if (migrated.changed) await persist(migrated.config);
    cache = migrated.config;
    return cache;
  }

  function loadConfig(): Promise<AppConfig> {
    return enqueue(async () => structuredClone(await readCurrent()));
  }

  async function saveConfig(config: AppConfig): Promise<void> {
    const snapshot = validateConfig(config);
    await enqueue(async () => {
      await readCurrent();
      await persist(snapshot);
      cache = snapshot;
    });
  }

  function updateConfig(update: (current: AppConfig) => AppConfig): Promise<void> {
    return enqueue(async () => {
      const next = validateConfig(update(await readCurrent()));
      await persist(next);
      cache = next;
    });
  }

  async function setProjectFlag(
    field: 'pinned' | 'hidden',
    id: string,
    enabled: boolean,
  ): Promise<void> {
    const key = projectId(id);
    const value = booleanSetting(enabled, field);
    await updateConfig((config) => {
      const ids = new Set(config[field]);
      if (value) ids.add(key);
      else ids.delete(key);
      return { ...config, [field]: [...ids] };
    });
  }

  async function setBoolean(
    field: 'confirmOnCloseTab' | 'terminalMultilineEnter' | 'terminalCopyPaste',
    value: boolean,
  ): Promise<void> {
    const validated = booleanSetting(value, field);
    await updateConfig((config) => ({ ...config, [field]: validated }));
  }

  return {
    loadConfig,
    saveConfig,
    setProjectPinned: (id: string, pinned: boolean) => setProjectFlag('pinned', id, pinned),
    setProjectHidden: (id: string, hidden: boolean) => setProjectFlag('hidden', id, hidden),
    async setLastAgent(id: string, agent: AgentId): Promise<void> {
      const key = projectId(id);
      const value = agentId(agent);
      await updateConfig((config) => ({
        ...config,
        lastAgentByProject: { ...config.lastAgentByProject, [key]: value },
      }));
    },
    async getLastAgent(id: string): Promise<AgentId | null> {
      const key = projectId(id);
      const config = await loadConfig();
      return Object.hasOwn(config.lastAgentByProject, key) ? config.lastAgentByProject[key] : null;
    },
    async setProjectOrder(agent: AgentId, ids: string[]): Promise<void> {
      const key = agentId(agent);
      const order = projectIds(ids);
      await updateConfig((config) => ({
        ...config,
        projectOrder: { ...config.projectOrder, [key]: order },
      }));
    },
    async forgetProject(id: string): Promise<void> {
      const key = projectId(id);
      await updateConfig((config) => {
        const lastAgentByProject = { ...config.lastAgentByProject };
        delete lastAgentByProject[key];
        const projectOrder = { ...config.projectOrder };
        for (const agent of Object.keys(projectOrder)) {
          const keyAgent = agentId(agent);
          projectOrder[keyAgent] = projectOrder[keyAgent].filter((project) => project !== key);
        }
        return {
          ...config,
          pinned: config.pinned.filter((project) => project !== key),
          hidden: config.hidden.filter((project) => project !== key),
          lastAgentByProject,
          projectOrder,
        };
      });
    },
    async getLayout(): Promise<LayoutConfig> {
      return (await loadConfig()).layout;
    },
    async setLayout(layout: LayoutConfig): Promise<void> {
      const validated = layoutSetting(layout);
      await updateConfig((config) => ({ ...config, layout: validated }));
    },
    async getTheme(): Promise<ThemeMode> {
      return (await loadConfig()).theme;
    },
    async setTheme(theme: ThemeMode): Promise<void> {
      const validated = themeSetting(theme);
      await updateConfig((config) => ({ ...config, theme: validated }));
    },
    async getConfirmOnCloseTab(): Promise<boolean> {
      return (await loadConfig()).confirmOnCloseTab;
    },
    setConfirmOnCloseTab: (value: boolean) => setBoolean('confirmOnCloseTab', value),
    async getTerminalMultilineEnter(): Promise<boolean> {
      return (await loadConfig()).terminalMultilineEnter;
    },
    setTerminalMultilineEnter: (value: boolean) => setBoolean('terminalMultilineEnter', value),
    async getTerminalCopyPaste(): Promise<boolean> {
      return (await loadConfig()).terminalCopyPaste;
    },
    setTerminalCopyPaste: (value: boolean) => setBoolean('terminalCopyPaste', value),
  };
}
