import './helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createProtocol, serve } from '../scripts/agent-tools/protocol.mjs';
import { TOOL_DEFINITIONS, createTools } from '../scripts/agent-tools/tools.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const request = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });

async function initialized(tools = {}) {
  const protocol = createProtocol(tools);
  const response = await protocol(
    request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fixture', version: '1' },
    }),
  );
  assert.equal(response.result.protocolVersion, '2025-06-18');
  await protocol({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return protocol;
}

test('tools require initialization and expose no arbitrary command or mutation endpoint', async () => {
  const protocol = createProtocol({});
  assert.equal((await protocol(request(1, 'tools/list'))).error.code, -32002);
  const ready = await initialized();
  const response = await ready(request(2, 'tools/list'));
  assert.deepEqual(response.result.tools, TOOL_DEFINITIONS);
  assert.deepEqual(
    TOOL_DEFINITIONS.map((tool) => tool.name),
    ['repository_doctor', 'maintenance_preview', 'run_validation', 'verify_evidence'],
  );
  assert.ok(TOOL_DEFINITIONS.every((tool) => !tool.name.includes('apply')));
});

test('legacy clients are offered only the implemented protocol version instead of unsupported batch semantics', async () => {
  for (const requested of ['2024-11-05', '2025-03-26']) {
    const protocol = createProtocol({});
    const response = await protocol(
      request(1, 'initialize', {
        protocolVersion: requested,
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1' },
      }),
    );
    assert.equal(response.result.protocolVersion, '2025-06-18');
    await protocol({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const batch = await protocol([request(2, 'tools/list'), request(3, 'ping')]);
    assert.equal(batch.error.code, -32600);
  }
});

test('unknown tools, extra arguments, malformed requests, and arbitrary commands are rejected', async () => {
  const protocol = await initialized();
  for (const value of [
    request(2, 'tools/call', { name: 'run_validation', arguments: { check: 'release' } }),
    request(3, 'tools/call', { name: 'maintenance_preview', arguments: { apply: true } }),
    request(4, 'tools/call', { name: 'shell', arguments: { command: 'git push' } }),
    request(5, 'tools/call', {
      name: 'run_validation',
      arguments: { check: { toString: 'docs' } },
    }),
  ])
    assert.equal((await protocol(value)).error.code, -32602);
  assert.equal((await protocol({ jsonrpc: '2.0', id: {}, method: 'ping' })).error.code, -32600);
  assert.equal((await protocol([request(1, 'ping')])).error.code, -32600);
  assert.equal((await protocol(request(5, 'unknown'))).error.code, -32601);
});

test('tool calls reject null arguments but default omitted arguments to an empty object', async () => {
  let received;
  const protocol = await initialized({
    repository_doctor: async (args) => {
      received = args;
      return { status: 'passed' };
    },
  });
  const invalid = await protocol(
    request(2, 'tools/call', { name: 'repository_doctor', arguments: null }),
  );
  assert.equal(invalid.error.code, -32602);
  assert.equal(received, undefined);

  const valid = await protocol(request(3, 'tools/call', { name: 'repository_doctor' }));
  assert.equal(valid.result.isError, false);
  assert.deepEqual(received, {});
});

for (const exitCode of [0, 5]) {
  test(`fixed validation really executes and retains the actual exit ${exitCode}`, async (t) => {
    const fixture = await realpath(await mkdtemp(join(tmpdir(), 'parallel-agents-tool-')));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    const git = (...args) =>
      execFileAsync('git', [
        '-c',
        'user.name=Tool Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgSign=false',
        '-c',
        `core.hooksPath=${join(fixture, 'disabled-hooks')}`,
        '-C',
        fixture,
        ...args,
      ]);
    await git('init', '--initial-branch=main');
    await writeFile(join(fixture, '.gitignore'), 'reports/\n');
    await writeFile(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'tool-fixture',
        version: '1.0.0',
        scripts: { 'check:docs': 'node validate.cjs' },
      }),
    );
    await writeFile(
      join(fixture, 'validate.cjs'),
      `require('node:fs').writeFileSync('reports/executed.txt','actual');process.exit(${exitCode});\n`,
    );
    await mkdir(join(fixture, 'src'));
    await writeFile(join(fixture, 'src', 'app.ts'), 'original');
    await git('add', '.');
    await git('commit', '-m', 'Fixture');
    const tools = await createTools(fixture);
    const result = await tools.run_validation({ check: 'docs' });
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.status, exitCode === 0 ? 'passed' : 'failed');
    assert.equal(await readFile(join(fixture, 'reports', 'executed.txt'), 'utf8'), 'actual');
    assert.equal(await readFile(join(fixture, 'src', 'app.ts'), 'utf8'), 'original');
    const verified = await tools.verify_evidence({ path: result.evidence });
    assert.equal(verified.sourceMatches, true);
    assert.equal(verified.independentExecutionProof, false);
  });
}

test('tool failures remain visible and cannot be serialized as successful execution', async () => {
  const protocol = await initialized({
    run_validation: async () => ({ status: 'failed', exitCode: 7 }),
  });
  const response = await protocol(
    request(2, 'tools/call', { name: 'run_validation', arguments: { check: 'docs' } }),
  );
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.exitCode, 7);
  const throwing = await initialized({
    repository_doctor: async () => {
      throw new Error('Fixture failure');
    },
  });
  const failure = await throwing(
    request(2, 'tools/call', { name: 'repository_doctor', arguments: {} }),
  );
  assert.equal(failure.result.isError, true);
  assert.match(failure.result.content[0].text, /Fixture failure/);
});

test('only one bounded tool run can be in flight and busy work is not queued indefinitely', async () => {
  const gate = Promise.withResolvers();
  const protocol = await initialized({ maintenance_preview: () => gate.promise });
  const first = protocol(request(2, 'tools/call', { name: 'maintenance_preview', arguments: {} }));
  const second = await protocol(
    request(3, 'tools/call', { name: 'maintenance_preview', arguments: {} }),
  );
  assert.equal(second.error.code, -32001);
  gate.resolve({ status: 'clean' });
  assert.equal((await first).result.isError, false);
});

test('read-only preview does not permit paths, evidence escapes, or unknown checks', async () => {
  const tools = await createTools(root);
  await assert.rejects(tools.maintenance_preview({ root: 'C:\\' }), /argument/i);
  await assert.rejects(tools.run_validation({ check: 'npm publish' }), /check/i);
  await assert.rejects(tools.verify_evidence({ path: '../../.env' }));
});

test('stdio transport supports chunked UTF-8 lines, parse errors, and silent notifications', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += chunk;
  });
  const finished = serve(input, output, createProtocol({}));
  const message =
    JSON.stringify(
      request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: '测试', version: '1' },
      }),
    ) + '\n';
  const buffer = Buffer.from(message);
  for (const byte of buffer) input.write(Buffer.from([byte]));
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  input.write('{broken}\n');
  input.write(JSON.stringify(request(2, 'ping')) + '\n');
  input.end();
  await finished;
  const messages = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(messages.length, 3);
  assert.equal(messages[0].id, 1);
  assert.equal(messages[1].error.code, -32700);
  assert.equal(messages[2].id, 2);
});

test('oversized MCP input is rejected without unbounded buffering', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk));
  const finished = serve(input, output, createProtocol({}));
  input.end('a'.repeat(70_000));
  await assert.rejects(finished, /limit/i);
  assert.ok(Buffer.concat(chunks).length < 1024);
});

test('stdio replies honor a slow client instead of accumulating an unbounded write queue', async () => {
  const input = new PassThrough();
  let peak = 0;
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      setTimeout(callback, 1);
    },
  });
  const originalWrite = output.write.bind(output);
  output.write = (...args) => {
    const result = originalWrite(...args);
    peak = Math.max(peak, output.writableLength);
    return result;
  };
  const finished = serve(input, output, createProtocol({}));
  input.end(
    Array.from({ length: 50 }, (_, id) => JSON.stringify(request(id, 'ping'))).join('\n') + '\n',
  );
  await finished;
  assert.ok(peak < 128, `Buffered ${peak} response bytes for a slow client`);
});

test('the actual stdio server starts without provider access and returns a protocol handshake', async (t) => {
  const child = spawn(process.execPath, [resolve(root, 'scripts', 'mcp-server.mjs')], {
    cwd: root,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stdin.end(
    JSON.stringify(
      request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'integration', version: '1' },
      }),
    ) + '\n',
  );
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).result.serverInfo.name, 'parallel-agents-engineering');
});
