import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PreferencesStore } from '../src/main/preferences-store.ts';

test('names, font settings and registered projects persist without losing concurrent writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  assert.equal((await store.read()).fontSize, 14);
  assert.equal((await store.read()).fontFamily, 'default');
  assert.equal((await store.read()).fontBold, false);
  await Promise.all([
    store.renameSession('codex', 'same-id', '  Fix login  '),
    store.renameSession('copilot', 'same-id', 'Review API'),
    store.setFontSize(18),
    store.setFontFamily('consolas'),
    store.setFontBold(true),
    store.registerProject({ id: 'codex:manual:test', agent: 'codex', realPath: dir }),
  ]);
  const reopened = new PreferencesStore(path);
  const data = await reopened.read();
  assert.equal(data.sessionNames['codex:same-id'], 'Fix login');
  assert.equal(data.sessionNames['copilot:same-id'], 'Review API');
  assert.equal(data.fontSize, 18);
  assert.equal(data.fontFamily, 'consolas');
  assert.equal(data.fontBold, true);
  assert.equal(data.projects[0].realPath, dir);
  await assert.rejects(store.renameSession('codex', 'same-id', '  '), /name/i);
  await assert.rejects(store.setFontSize(50), /font/i);
  await store.forgetProject('codex:manual:test');
  assert.equal((await store.read()).projects.length, 0);
  await store.setFontBold(false);
  assert.equal((await new PreferencesStore(path).read()).fontBold, false);
});

test('invalid stored JSON surfaces an error instead of overwriting preferences', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  await writeFile(path, '{broken');
  await assert.rejects(new PreferencesStore(path).setFontSize(16), SyntaxError);
});

test('invalid registered projects reject without poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  const valid = {
    sessionNames: {},
    fontSize: 14,
    fontBold: false,
    projects: [{ id: 'codex:manual:test', agent: 'codex', realPath: dir }],
  };
  await writeFile(path, JSON.stringify({ ...valid, projects: [null] }));
  await assert.rejects(store.read(), /registered project/i);
  await assert.rejects(store.setFontSize(16), /registered project/i);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).projects, [null]);

  for (const project of [
    {},
    { id: '', agent: 'codex', realPath: dir },
    { id: 'bad-agent', agent: 'unknown', realPath: dir },
    { id: 'bad-path', agent: 'codex', realPath: '' },
    { id: 'bad-history', agent: 'codex', realPath: dir, historyPath: 1 },
  ]) {
    assert.throws(() => store.registerProject(project), /registered project/i);
  }

  await writeFile(path, JSON.stringify(valid));
  const recovered = new PreferencesStore(path);
  await recovered.registerProject({ id: 'copilot:manual:test', agent: 'copilot', realPath: dir });
  assert.equal((await recovered.read()).projects.length, 2);
});

test('legacy preferences default typography options and preserve existing settings when migrated', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const legacy = { sessionNames: { 'codex:session': 'Existing name' }, fontSize: 20, projects: [] };
  await writeFile(path, JSON.stringify(legacy));
  const store = new PreferencesStore(path);
  assert.deepEqual(await store.read(), { ...legacy, fontFamily: 'default', fontBold: false });
  await store.setFontSize(21);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    ...legacy,
    fontSize: 21,
    fontFamily: 'default',
    fontBold: false,
  });
});

test('invalid font families reject without overwriting preferences or poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  await store.setFontFamily('cascadia-mono');
  const original = await readFile(path, 'utf8');
  for (const invalid of [undefined, null, '', 'Comic Sans MS', 0, [], {}]) {
    await assert.rejects(store.setFontFamily(invalid), /font family/i);
    assert.equal(await readFile(path, 'utf8'), original);
  }
  for (const invalid of [null, '', 'Comic Sans MS', 0, [], {}]) {
    const text = JSON.stringify({
      sessionNames: {},
      fontSize: 14,
      fontFamily: invalid,
      projects: [],
      fontBold: false,
    });
    await writeFile(path, text);
    await assert.rejects(store.read(), /font family/i);
    await assert.rejects(store.setFontSize(18), /font family/i);
    await assert.rejects(store.setFontFamily('default'), /font family/i);
    assert.equal(await readFile(path, 'utf8'), text);
  }
  await writeFile(path, original);
  await store.setFontFamily('monospace');
  assert.equal((await store.read()).fontFamily, 'monospace');
});

test('invalid bold values reject without overwriting preferences or poisoning later writes', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), '.pa-preferences-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'preferences.json');
  const store = new PreferencesStore(path);
  await store.setFontBold(true);
  const original = await readFile(path, 'utf8');
  for (const invalid of [undefined, null, 0, 1, 'true', 'false', [], {}]) {
    await assert.rejects(store.setFontBold(invalid), /font bold.*boolean/i);
    assert.equal(await readFile(path, 'utf8'), original);
  }
  for (const invalid of [null, 0, 1, 'true', 'false', [], {}]) {
    const text = JSON.stringify({
      sessionNames: {},
      fontSize: 14,
      fontFamily: 'default',
      projects: [],
      fontBold: invalid,
    });
    await writeFile(path, text);
    await assert.rejects(store.read(), /font bold.*boolean/i);
    await assert.rejects(store.setFontSize(18), /font bold.*boolean/i);
    await assert.rejects(store.setFontBold(false), /font bold.*boolean/i);
    assert.equal(await readFile(path, 'utf8'), text);
  }
  await writeFile(path, original);
  await store.setFontBold(false);
  assert.equal((await store.read()).fontBold, false);
});
