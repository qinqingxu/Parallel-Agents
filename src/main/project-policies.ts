import type { Project } from '../shared/types.ts';

export interface CopilotScanResult {
  projects: Project[];
  valid: boolean;
  candidateCount: number;
  parsedCount: number;
}

const DELETABLE_AGENTS = new Set(['claude', 'codex', 'gemini', 'copilot']);

export function stabilizeCopilotProjects(previous: Project[], scan: CopilotScanResult): Project[] {
  if (!scan.valid || (scan.candidateCount > 0 && scan.parsedCount === 0)) return previous;
  return scan.projects;
}

export function removeProjectsFromSnapshot(snapshot: Project[], ids: string[]): Project[] {
  const removed = new Set(ids);
  return snapshot.filter((project) => !removed.has(project.id));
}

export function validateMissingProjectIds(projects: Project[], ids: string[]): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return [...new Set(ids)].map((id) => {
    const project = byId.get(id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    if (!DELETABLE_AGENTS.has(project.agent)) {
      throw new Error(`Delete not supported for agent: ${project.agent}`);
    }
    if (project.exists) throw new Error(`Project is not missing: ${id}`);
    return project;
  });
}
