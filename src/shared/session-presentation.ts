import type { AgentId } from './types';

export function validateSessionName(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    throw new Error('Session name must contain 1 to 120 characters.');
  }
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) <= 0x1f) throw new Error('Session name must be a single line.');
  }
  return name.trim();
}

export function applySessionNames<T extends { agent: AgentId; id: string; title: string }>(
  sessions: T[],
  names: Record<string, string>,
): T[] {
  return sessions.map((session) => ({
    ...session,
    title: names[`${session.agent}:${session.id}`] ?? session.title,
  }));
}
