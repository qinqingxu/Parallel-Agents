import { randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diagnose } from '../doctor.mjs';
import { readActiveLearnedRules } from '../check-agent-corpus.mjs';
import { prepareReportDirectory } from '../ci-report.mjs';
import { captureCandidate, sealEvidence, verifyEvidence } from '../evidence/provenance.mjs';
import { runMaintenance } from '../maintenance.mjs';
import { resolveNpmCli, runOwnedProcess, validationEnvironment } from '../maintenance/process.mjs';

const checks = {
  docs: 'check:docs',
  format: 'format:check',
  lint: 'lint',
  types: 'typecheck',
  unit: 'test',
};
const empty = { type: 'object', properties: {}, additionalProperties: false };
const annotation = (readOnlyHint) => ({
  readOnlyHint,
  destructiveHint: false,
  idempotentHint: readOnlyHint,
  openWorldHint: false,
});

export const TOOL_DEFINITIONS = [
  {
    name: 'repository_doctor',
    description:
      'Read local development prerequisites; never install tools, authenticate, or launch the application.',
    inputSchema: empty,
    annotations: annotation(true),
  },
  {
    name: 'maintenance_preview',
    description: 'Inspect bounded non-runtime formatting drift; no repair, commit, or publication.',
    inputSchema: empty,
    annotations: annotation(true),
  },
  {
    name: 'run_validation',
    description:
      'Run one fixed local check and record source-bound evidence. Fixture/report writes are confined to local validation; no arbitrary command, install, release, or publish.',
    inputSchema: {
      type: 'object',
      required: ['check'],
      properties: { check: { type: 'string', enum: Object.keys(checks) } },
      additionalProperties: false,
    },
    annotations: annotation(false),
  },
  {
    name: 'verify_evidence',
    description:
      'Verify an existing evidence envelope and artifact hashes against current source. Does not certify that declared workflow outcomes were executed.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string', minLength: 1, maxLength: 400 } },
      additionalProperties: false,
    },
    annotations: annotation(true),
  },
];

export function validateArguments(name, args) {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error('Unknown engineering tool.');
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Tool arguments must be an object.');
  const schema = definition.inputSchema;
  if (Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key)))
    throw new Error('Unknown tool argument.');
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(args, key)) throw new Error(`Missing tool argument: ${key}`);
  }
  if (
    name === 'run_validation' &&
    (typeof args.check !== 'string' || !Object.hasOwn(checks, args.check))
  )
    throw new Error('Unsupported validation check.');
  if (
    name === 'verify_evidence' &&
    (typeof args.path !== 'string' || !args.path || args.path.length > 400)
  ) {
    throw new Error('Invalid evidence path argument.');
  }
}

export async function createTools(directory) {
  const root = await realpath(directory);
  return {
    async repository_doctor(args) {
      validateArguments('repository_doctor', args);
      const report = diagnose({
        root,
        npmCli: await resolveNpmCli(),
        env: validationEnvironment(),
      });
      report.agentCorpus = { activeLearnedRules: await readActiveLearnedRules(root) };
      return { status: report.ok ? 'passed' : 'failed', report };
    },
    async maintenance_preview(args) {
      validateArguments('maintenance_preview', args);
      const result = await runMaintenance({ root });
      return { status: result.receipt.status, exitCode: result.exitCode, receipt: result.receipt };
    },
    async run_validation(args) {
      validateArguments('run_validation', args);
      const source = await captureCandidate(root);
      const reports = await prepareReportDirectory(root, 'agent-validation');
      const id = `${Date.now()}-${randomUUID()}`;
      const output = join(reports, id);
      await mkdir(output);
      const npmCli = await resolveNpmCli();
      const command = ['npm', 'run', checks[args.check]];
      const result = await runOwnedProcess(process.execPath, [npmCli, 'run', checks[args.check]], {
        cwd: root,
        env: validationEnvironment(),
        timeoutMs: 120_000,
        maxOutputBytes: 1024 * 1024,
        capture: false,
      });
      const report = {
        schemaVersion: 1,
        source,
        command,
        ...result,
        scope: 'One local engineering check; not a full validation or production qualification.',
      };
      const artifact = `reports/agent-validation/${id}/report.json`;
      const evidence = `reports/agent-validation/${id}/evidence.json`;
      await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
        flag: 'wx',
      });
      await sealEvidence(root, {
        source,
        origin: 'local-command',
        artifacts: [artifact],
        output: evidence,
      });
      return {
        status: result.status,
        exitCode: result.exitCode,
        command,
        report: artifact,
        evidence,
      };
    },
    async verify_evidence(args) {
      validateArguments('verify_evidence', args);
      return { status: 'passed', ...(await verifyEvidence(root, args.path)) };
    },
  };
}
