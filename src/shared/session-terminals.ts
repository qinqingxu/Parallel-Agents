export type SessionShellProfile = string;

const AGENT_SUFFIX = '::agent';
const SHELL_PREFIX = '::shell:';
const SESSION_TAB_PREFIX = '::session:';

export function agentTerminalKey(projectId: string): string {
  return `${projectId}${AGENT_SUFFIX}`;
}

export function shellTerminalKey(projectId: string, profile: SessionShellProfile): string {
  return `${projectId}${SHELL_PREFIX}${profile}`;
}

export function terminalKeysForProject(
  projectId: string,
  shellProfiles: SessionShellProfile[],
): string[] {
  return [
    agentTerminalKey(projectId),
    ...shellProfiles.map((profile) => shellTerminalKey(projectId, profile)),
  ];
}

export function isTerminalKeyForProject(terminalKey: string, projectId: string): boolean {
  return terminalKey.startsWith(`${projectId}::`);
}

export function makeSessionTabKey(projectId: string, sessionId: string): string {
  return `${projectId}${SESSION_TAB_PREFIX}${sessionId}`;
}

export function parseSessionTabKey(tabKey: string): {
  projectId: string;
  sessionId: string | null;
} {
  const markerIndex = tabKey.indexOf(SESSION_TAB_PREFIX);
  if (markerIndex < 0) return { projectId: tabKey, sessionId: null };

  return {
    projectId: tabKey.slice(0, markerIndex),
    sessionId: tabKey.slice(markerIndex + SESSION_TAB_PREFIX.length),
  };
}

export function sessionTabLabelSuffix(title: string, sessionId: string): string {
  const cleanTitle = title.trim();
  if (cleanTitle.length > 0) return cleanTitle;
  return sessionId.slice(0, 9) || 'session';
}
