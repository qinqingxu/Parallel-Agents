import type { Project } from '../../shared/types';
import { canDeleteProject } from '../../shared/project-delete.ts';

export function pickDeletableMissingProjectIds(
  projects: Project[],
  candidateIds: string[],
): string[] {
  const uniqueIds = [...new Set(candidateIds)];
  const byId = new Map(projects.map((project) => [project.id, project]));
  return uniqueIds.filter((id) => {
    const project = byId.get(id);
    return !!project && !project.exists && canDeleteProject(project.agent);
  });
}
