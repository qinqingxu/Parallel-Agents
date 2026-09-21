import type { SessionShellProfile } from '../../shared/session-terminals.ts';
import { agentTerminalKey, shellTerminalKey } from '../../shared/session-terminals.ts';

export interface TabState {
  openTabs: string[];
  activeTabId: string | null;
}

export function nextSessionTab(
  openTabs: string[],
  activeTabId: string | null,
  backwards = false,
): string | null {
  if (openTabs.length === 0) return null;
  const index = activeTabId ? openTabs.indexOf(activeTabId) : -1;
  if (index < 0) return backwards ? openTabs[openTabs.length - 1] : openTabs[0];
  return openTabs[(index + (backwards ? -1 : 1) + openTabs.length) % openTabs.length];
}

export function omitRecordKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

export function cleanupShellStateForTabs<T>(
  record: Record<string, T>,
  closingTabs: string[],
): Record<string, T> {
  return omitRecordKeys(record, closingTabs);
}

export function setTabShellVisibility(
  openTabs: string[],
  tabShellVisible: Record<string, boolean>,
  tabId: string,
  visible: boolean,
): Record<string, boolean> {
  if (!openTabs.includes(tabId)) return tabShellVisible;
  return { ...tabShellVisible, [tabId]: visible };
}

export function terminalKeysForClosingTabs(
  tabIds: string[],
  tabShellOpened: Record<string, boolean>,
  tabShellProfile: Record<string, SessionShellProfile>,
): string[] {
  const keys: string[] = [];
  for (const tabId of tabIds) {
    keys.push(agentTerminalKey(tabId));
    if (tabShellOpened[tabId]) {
      keys.push(shellTerminalKey(tabId, tabShellProfile[tabId] ?? 'default'));
    }
  }
  return keys;
}

export function tabKeysForProject(
  tabProjectId: Record<string, string>,
  projectId: string,
): string[] {
  return Object.keys(tabProjectId).filter((tabId) => tabProjectId[tabId] === projectId);
}

export function closeTabIds(
  openTabs: string[],
  activeTabId: string | null,
  ids: string[],
): TabState {
  const closing = new Set(ids);
  const next = openTabs.filter((id) => !closing.has(id));
  if (!activeTabId || !closing.has(activeTabId)) {
    return { openTabs: next, activeTabId };
  }

  const activeIndex = openTabs.indexOf(activeTabId);
  return {
    openTabs: next,
    activeTabId:
      next.find((id) => openTabs.indexOf(id) > activeIndex) ??
      [...next].reverse().find((id) => openTabs.indexOf(id) < activeIndex) ??
      null,
  };
}
