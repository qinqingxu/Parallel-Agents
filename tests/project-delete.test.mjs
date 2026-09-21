import assert from 'node:assert/strict';
import test from 'node:test';

import { canDeleteProject, deleteMessageFor } from '../src/shared/project-delete.ts';

test('allows deleting Codex project history with an accurate warning', () => {
  const project = {
    id: 'codex:C:\\Work\\Repo',
    agent: 'codex',
    dirName: 'C:\\Work\\Repo',
    realPath: 'C:\\Work\\Repo',
    displayName: 'Repo',
    exists: true,
    pinned: false,
    hidden: false,
    sessionCount: 2,
    lastActivity: 1,
  };

  assert.equal(canDeleteProject('codex'), true);
  assert.match(deleteMessageFor(project), /~\/\.codex\/sessions\//);
  assert.match(deleteMessageFor(project), /working directory on disk is not touched/);
});
