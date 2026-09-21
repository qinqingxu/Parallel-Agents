import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDocs } from '../scripts/check-docs.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const checker = join(repository, 'scripts', 'check-docs.mjs');
const scripts = {
  dev: 'electron-vite dev',
  build: 'electron-vite build',
  test: 'node --test',
  'check:docs': 'node scripts/check-docs.mjs',
};

async function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, ...name.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

async function fixture(t, files = {}) {
  const artifacts = join(repository, 'reports');
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, 'check-docs-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await writeFiles(root, {
    'package.json': JSON.stringify({ scripts }),
    'README.md': '# Fixture\n',
    'src/main/index.ts': 'export {};\n',
    'src/shared/types.ts': 'export {};\n',
    'scripts/example.mjs': 'export {};\n',
    'tests/example.test.mjs': 'export {};\n',
    'resources/guide image.png': 'fixture image',
    ...files,
  });
  return root;
}

test('stale npm scripts in inline commands and runnable fences identify the file and line', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '# Usage',
      'Run `npm run removed`.',
      '',
      '```powershell',
      'npm run build && npm run stale -- --watch',
      'npm test',
      '```',
    ].join('\n'),
  });

  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /README\.md:2:.*npm script "removed".*package\.json/);
  assert.match(errors[1], /README\.md:5:.*npm script "stale".*package\.json/);
});

test('run-script, npm.cmd, common quiet flags, and lifecycle aliases are checked', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '`npm.cmd run-script removed`',
      '`npm --silent run quiet-removed`',
      '`npm run --silent also-removed`',
      '`npm start`',
      '`npm stop`',
      '`npm restart`',
    ].join('\n'),
  });

  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 6);
  for (const script of ['removed', 'quiet-removed', 'also-removed', 'start', 'stop', 'restart']) {
    assert.ok(errors.some((error) => error.includes(`npm script "${script}"`)));
  }
});

test('valid commands, arguments, prompts, and built-in npm operations pass without execution', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '`npm ci` and `npm install` install dependencies.',
      '`npm run-script build` and `npm run --silent build`.',
      '`npm --silent run build` and `npm -s run build`.',
      '```powershell',
      'PS C:\\repo> npm run build -- --mode development',
      'npm test; npm.cmd run check:docs',
      '# npm run commented-out',
      'echo "npm run printed-not-executed"',
      'npm --prefix .\\Hackathon\\video-project run render',
      '```',
      '```sh',
      '$ npm run build',
      'npm run dev || npm test',
      '```',
    ].join('\n'),
  });
  assert.deepEqual((await checkDocs(root)).errors, []);
});

test('Windows CMD prompts are checked while REM and double-colon comment lines are ignored', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '```cmd',
      'C:\\repo> npm run removed',
      'REM npm run example && npm run still-a-comment',
      ':: npm run example && npm run also-a-comment',
      '```',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /README\.md:2:.*npm script "removed"/);
});

test('comments, non-shell examples, and explicit placeholders are not runnable contracts', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '<!-- `npm run old` and [old](missing.md)',
      '<img src="missing.png"> -->',
      ...['json', 'typescript', 'text', 'mermaid'].flatMap((language) => [
        '```' + language,
        'npm run illustrative',
        '[sample](missing.md)',
        '<img src="missing.png">',
        '`src/main/missing.ts`',
        '```',
      ]),
      'Use `npm run <script>` or `npm run ${script}` as a syntax example.',
      'Examples: `src/<module>.ts`, `src/**/*.ts`, `src/...`, `src\\...`.',
      '`const label = "npm run example"` is a code example.',
      '`[example](missing.md)` shows link syntax.',
    ].join('\n'),
  });
  assert.deepEqual((await checkDocs(root)).errors, []);
});

test('longer and tilde fences keep embedded Markdown examples out of the check', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '````markdown',
      '```powershell',
      'npm run example-only',
      '```',
      '[not a real link](missing.md)',
      '````',
      '~~~text',
      '`npm run another-example`',
      '~~~',
      '`npm run removed`',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /README\.md:10:.*npm script "removed"/);
});

test('unlabelled fences check command lines but do not treat source examples as links', async (t) => {
  const root = await fixture(t, {
    'README.md': '```\nnpm run removed\n[example](missing.md)\n```\n',
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /README\.md:2:.*npm script "removed"/);
});

test('literal source code spans use the repository root with either path separator', async (t) => {
  const root = await fixture(t, {
    'docs/guide.md': [
      '`src/main/index.ts#not-a-checked-symbol`',
      '`src\\shared\\types.ts:10`',
      '`scripts/example.mjs` and `tests/example.test.mjs`',
      '`src/main/missing.ts`',
      '`src\\main\\gone.ts:42`',
      '`scripts/missing.mjs#export`',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /docs\/guide\.md:4:.*src\/main\/missing\.ts.*does not exist/);
  assert.match(errors[1], /docs\/guide\.md:5:.*src\\main\\gone\.ts:42.*does not exist/);
  assert.match(errors[2], /docs\/guide\.md:6:.*scripts\/missing\.mjs#export.*does not exist/);
});

test('local Markdown and HTML links resolve from the document, including encoded spaces', async (t) => {
  const root = await fixture(t, {
    'resources/guide (old).png': 'fixture image',
    'docs/deep/guide.md': [
      '[entry](../../src/main/index.ts#symbol-not-validated)',
      '[root entry](/src/main/index.ts)',
      '[folder](../../src/main/)',
      '[image](<../../resources/guide image.png> "Image title")',
      '![image](../../resources/guide%20image.png)',
      '[old image](<../../resources/guide (old).png>)',
      '[readme](../../README.md?plain=1#top "Read me")',
      '<a href="../../README.md">Readme</a>',
      '<IMG',
      '  SRC="../../resources/guide%20image.png" alt="Fixture">',
      "<img src='../../resources/guide%20image.png'>",
      '[windows](..\\..\\src\\main\\index.ts)',
    ].join('\n'),
  });
  assert.deepEqual((await checkDocs(root)).errors, []);
});

test('missing local destinations report Markdown links, images, HTML, and reference definitions', async (t) => {
  const root = await fixture(t, {
    'docs/new.md': [
      '[missing](missing.md)',
      '![image](../resources/missing.png)',
      '<img src="../resources/also-missing.png">',
      '[source]: ../src/main/gone.ts "Missing module"',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 4);
  for (let line = 1; line <= 4; line++) {
    assert.match(errors[line - 1], new RegExp(`docs/new\\.md:${line}:.*does not exist`));
    assert.match(errors[line - 1], /[Uu]pdate/);
  }
});

test('full and collapsed reference links require definitions; shortcut brackets are not inferred', async (t) => {
  const root = await fixture(t, {
    'docs/guide.md': [
      '[Readme][ROOT guide]',
      '[root guide]: ../README.md',
      '![missing][unknown]',
      '[undefined][]',
      '[plain brackets are not necessarily links]',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /docs\/guide\.md:3:.*undefined link reference "unknown"/);
  assert.match(errors[1], /docs\/guide\.md:4:.*undefined link reference "undefined"/);
});

test('external links and anchors are distinguished without network or heading validation', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '[web](https://example.invalid/missing)',
      '[mail](mailto:maintainer@example.invalid)',
      '[cdn](//example.invalid/image.png)',
      '[anchor](#not-validated)',
      '[query](?plain=1)',
      '<a href="vscode://example.invalid/path">Open</a>',
      '<img src="data:image/png;base64,not-a-real-file">',
      '[source](src/main/index.ts?raw=1#not-validated)',
    ].join('\n'),
  });
  assert.deepEqual((await checkDocs(root)).errors, []);
});

test('links cannot escape the repository or refer to absolute Windows user paths', async (t) => {
  const root = await fixture(t, {
    'README.md': [
      '[outside](../private.md)',
      '[encoded outside](%2e%2e/private.md)',
      '[absolute](C:\\private\\notes.md)',
      '[network share](<\\\\server\\private\\notes.md>)',
    ].join('\n'),
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 4);
  for (const error of errors) assert.match(error, /repository/);
});

test('invalid URI encoding and null bytes fail with actionable diagnostics', async (t) => {
  const root = await fixture(t, {
    'README.md': '[bad](src/%broken.ts)\n[null](src/%00.ts)\n',
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /README\.md:1:.*invalid percent-encoding/);
  assert.match(errors[1], /README\.md:2:.*null byte/);
});

test('discovery includes nested, hidden, uppercase, and untracked working-tree Markdown', async (t) => {
  const root = await fixture(t, {
    '.gitignore': 'handbook/\n',
    '.github/copilot-instructions.md': '# Instructions\n',
    '.notes/review.MD': '# Notes\n',
    'docs/guide.md': '# Guide\n',
    'handbook/untracked.md': '`npm run removed`\n',
    'src/main/NOTES.md': '# Module notes\n',
  });
  const result = await checkDocs(root);
  assert.deepEqual(result.files, [
    '.github/copilot-instructions.md',
    '.notes/review.MD',
    'README.md',
    'docs/guide.md',
    'handbook/untracked.md',
    'src/main/NOTES.md',
  ]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /handbook\/untracked\.md:1:.*npm script "removed"/);
});

test('only documented historical and generated trees are excluded, not active docs or examples', async (t) => {
  const ignored = [
    '.git',
    'node_modules',
    'src/vendor/node_modules',
    'out',
    'dist',
    'release',
    'coverage',
    'reports',
    '.vite',
    'Hackathon',
    'docs/superpowers',
  ];
  const root = await fixture(t, {
    ...Object.fromEntries(
      ignored.map((directory) => [
        `${directory}/historical.md`,
        '`npm run historical-subproject-command`\n[old source](missing.ts)\n',
      ]),
    ),
    'docs/README.md': '# Active docs\n',
    'examples/new.md': '`npm run removed`\n',
  });
  const result = await checkDocs(root);
  assert.deepEqual(result.files, ['README.md', 'docs/README.md', 'examples/new.md']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /examples\/new\.md:1:.*npm script "removed"/);
});

test('links into excluded trees still require an existing target', async (t) => {
  const root = await fixture(t, {
    'Hackathon/archive.md': '[historical example](not-in-root.md)',
    'README.md': '[archive](Hackathon/archive.md)\n[missing](Hackathon/missing.md)\n',
  });
  const { errors } = await checkDocs(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /README\.md:2:.*Hackathon\/missing\.md.*does not exist/);
});

test('discovery does not follow symlinks and local links cannot resolve outside through them', async (t) => {
  const outside = await fixture(t, { 'hidden.md': '`npm run external-command`\n' });
  const root = await fixture(t, {
    'README.md': '[outside](linked/hidden.md)\n',
  });
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

  const result = await checkDocs(root);
  assert.deepEqual(result.files, ['README.md']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /README\.md:1:.*outside.*repository/);
});

test('diagnostics and file ordering are deterministic across repeated runs', async (t) => {
  const root = await fixture(t, {
    'z.md': '`npm run z-missing`',
    'a.md': '`npm run a-missing`\n[missing](missing.md)',
    'README.md': '\n'.repeat(10) + '`npm run root-missing`',
  });
  assert.deepEqual(await checkDocs(root), await checkDocs(root));
  assert.deepEqual((await checkDocs(root)).files, ['README.md', 'a.md', 'z.md']);
});

test('malformed manifest data is not silently treated as an empty script list', async (t) => {
  for (const content of [
    '{',
    '{"scripts":[]}',
    '{"scripts":null}',
    '{"scripts":{"build":false}}',
  ]) {
    await t.test(content, async (t) => {
      const root = await fixture(t, { 'package.json': content });
      await assert.rejects(checkDocs(root), /package\.json:/);
    });
  }
});

test('a missing manifest fails with its path instead of succeeding with no checks', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'package.json'));
  await assert.rejects(checkDocs(root), /package\.json:.*read/);
});

test('a root with no active Markdown fails instead of reporting a vacuous success', async (t) => {
  const root = await fixture(t);
  await rm(join(root, 'README.md'));
  await assert.rejects(checkDocs(root), /[Nn]o active Markdown/);
});

test('CLI succeeds for valid fixtures and exits nonzero with actionable errors for stale docs', async (t) => {
  const root = await fixture(t);
  const run = () => spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /Checked 1 Markdown file/);

  await writeFiles(root, { 'README.md': '`npm run removed`\n' });
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /README\.md:1:.*npm script "removed".*package\.json/);
  assert.doesNotMatch(bad.stdout, /Checked.*passed/);
});

test('CLI checks and writes the documentation contract inventory', async (t) => {
  const root = await fixture(t);
  const contract = join(root, 'docs', 'documentation-contracts.md');
  const run = (...args) =>
    spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: 'utf8' });

  const missing = run('--check-contract');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /documentation contract inventory is stale/i);
  assert.match(missing.stderr, /npm run docs:contracts:write/);

  const write = run('--write-contract');
  assert.equal(write.status, 0, write.stderr);
  assert.match(await readFile(contract, 'utf8'), /README\.md/);

  const current = run('--check-contract');
  assert.equal(current.status, 0, current.stderr);

  await writeFiles(root, { 'docs/new.md': '# New active document\n' });
  const stale = run('--check-contract');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /documentation contract inventory is stale/i);
});

test('CLI reports operational failures rather than swallowing malformed manifests', async (t) => {
  const root = await fixture(t, { 'package.json': '{' });
  const result = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package\.json:/);
});

test('CLI still checks the working directory when its entry point uses a directory alias', async (t) => {
  const root = await fixture(t, { 'README.md': '`npm run removed`\n' });
  await symlink(
    dirname(checker),
    join(root, 'tools'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = spawnSync(process.execPath, [join(root, 'tools', 'check-docs.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:1:.*npm script "removed"/);
});
