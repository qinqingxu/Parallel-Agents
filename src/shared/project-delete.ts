import type { AgentId, Project } from './types';

export function canDeleteProject(agent: AgentId): boolean {
  return agent === 'claude' || agent === 'codex' || agent === 'gemini' || agent === 'copilot';
}

export function deleteMessageFor(project: Project): string {
  if (project.agent === 'claude') {
    return `This will permanently delete ~/.claude/projects/${project.dirName}/ and all its sessions. The actual working directory on disk is not touched.`;
  }
  if (project.agent === 'codex') {
    return `This will permanently delete Codex session history for "${project.realPath}" from ~/.codex/sessions/. The actual working directory on disk is not touched.`;
  }
  if (project.agent === 'gemini') {
    return `This will permanently delete ~/.gemini/tmp/${project.dirName}/ and all its sessions. The actual working directory on disk is not touched.`;
  }
  if (project.agent === 'copilot') {
    return `This will permanently delete Copilot session history for "${project.realPath}" from ~/.copilot/session-state/. The actual working directory on disk is not touched.`;
  }
  return `Delete is not supported for ${project.agent} projects.`;
}
