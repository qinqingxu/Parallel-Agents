import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  deleteCodexProject,
  deleteCodexSession,
  filterCodexSessionsByProject,
  groupCodexSessionsByProject,
  listCodexSessions,
} from '../src/main/codex-storage.ts';

async function createRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-codex-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeSession(
  root,
  { id, cwd, timestamp, title = null, version = '0.42.0', datePath = ['2026', '09', '09'] },
) {
  const dir = join(root, 'sessions', ...datePath);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `rollout-${id}.jsonl`);
  const records = [
    {
      timestamp,
      type: 'session_meta',
      payload: { id, timestamp, cwd, cli_version: version },
    },
  ];
  if (title) {
    records.push({
      timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: title }],
      },
    });
  }
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return filePath;
}

test('discovers Codex sessions recursively and prefers indexed titles', async (t) => {
  const root = await createRoot(t);
  const projectPath = join(root, 'Project');
  await mkdir(projectPath);
  await writeSession(root, {
    id: 'session-indexed',
    cwd: projectPath,
    timestamp: '2026-09-09T10:00:00.000Z',
    title: 'Ignored fallback',
  });
  await writeSession(root, {
    id: 'session-fallback',
    cwd: projectPath,
    timestamp: '2026-09-09T11:00:00.000Z',
    title: 'Fallback user prompt',
    datePath: ['2026', '09', '08'],
  });
  await writeFile(
    join(root, 'session_index.jsonl'),
    `${JSON.stringify({
      id: 'session-indexed',
      thread_name: 'Indexed title',
      updated_at: '2026-09-09T12:00:00.000Z',
    })}\n`,
  );
  const malformedDir = join(root, 'sessions', '2026', '09', '07');
  await mkdir(malformedDir, { recursive: true });
  await writeFile(join(malformedDir, 'rollout-malformed.jsonl'), '{not-json}\n');

  const inventory = await listCodexSessions(root);

  assert.equal(inventory.length, 2);
  assert.equal(inventory[0].id, 'session-indexed');
  assert.equal(inventory[0].title, 'Indexed title');
  assert.equal(inventory[0].cwd, projectPath);
  assert.equal(inventory[0].version, '0.42.0');
  assert.equal(inventory[0].timestamp, Date.parse('2026-09-09T12:00:00.000Z'));
  assert.equal(inventory[1].id, 'session-fallback');
  assert.equal(inventory[1].title, 'Fallback user prompt');
});

test('groups Codex sessions by normalized project path', () => {
  const sessions = [
    {
      id: 'one',
      cwd: 'C:\\Work\\Repo',
      title: 'One',
      timestamp: 10,
      version: null,
      filePath: 'one.jsonl',
    },
    {
      id: 'two',
      cwd: 'c:\\work\\repo',
      title: 'Two',
      timestamp: 20,
      version: null,
      filePath: 'two.jsonl',
    },
    {
      id: 'other',
      cwd: 'C:\\Work\\Other',
      title: 'Other',
      timestamp: 30,
      version: null,
      filePath: 'other.jsonl',
    },
  ];
  const groups = groupCodexSessionsByProject(sessions);

  assert.deepEqual(groups[0], {
    realPath: 'C:\\Work\\Repo',
    sessionCount: 2,
    lastActivity: 20,
  });
  assert.deepEqual(
    filterCodexSessionsByProject(sessions, 'c:\\WORK\\REPO').map((session) => session.id),
    ['one', 'two'],
  );
});

test('deletes only the targeted Codex session and project files', async (t) => {
  const root = await createRoot(t);
  const firstProject = join(root, 'First');
  const secondProject = join(root, 'Second');
  const firstFile = await writeSession(root, {
    id: 'first-session',
    cwd: firstProject,
    timestamp: '2026-09-09T10:00:00.000Z',
  });
  const secondFile = await writeSession(root, {
    id: 'second-session',
    cwd: firstProject,
    timestamp: '2026-09-09T11:00:00.000Z',
    datePath: ['2026', '09', '08'],
  });
  const otherFile = await writeSession(root, {
    id: 'other-session',
    cwd: secondProject,
    timestamp: '2026-09-09T12:00:00.000Z',
    datePath: ['2026', '09', '07'],
  });

  await deleteCodexSession('first-session', root);
  await assert.rejects(readFile(firstFile), { code: 'ENOENT' });
  await readFile(secondFile);
  await readFile(otherFile);

  await deleteCodexProject(firstProject.toUpperCase(), root);
  await assert.rejects(readFile(secondFile), { code: 'ENOENT' });
  await readFile(otherFile);
  await assert.rejects(
    deleteCodexSession('missing-session', root),
    /Session not found: missing-session/,
  );
});
