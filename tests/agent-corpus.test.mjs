import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkAgentCorpus, readActiveLearnedRules } from '../scripts/check-agent-corpus.mjs';

async function writeFiles(files) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-corpus-'));
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  return root;
}

async function createSymlinkOrSkip(t, target, path, type) {
  try {
    await symlink(target, path, type);
  } catch (error) {
    if (['EPERM', 'ENOSYS', 'EACCES'].includes(error.code)) {
      t.skip(`Symlink creation is unavailable on this host (${error.code}).`);
      return false;
    }
    throw error;
  }
  return true;
}

test('agent instruction corpus remains machine-operable and scoped', async () => {
  const result = await checkAgentCorpus();
  assert.deepEqual(result.errors, []);
  assert.ok(result.prompts.includes('.github/prompts/validation-repair.prompt.md'));
  assert.ok(result.skills.includes('.github/skills/validate-changes/SKILL.md'));
  assert.ok(result.instructions.includes('.github/instructions/tooling.instructions.md'));
});

test('prompt validation fails closed on missing structured guardrails', async (t) => {
  const root = await writeFiles({
    'AGENTS.md': '# Guide\n',
    '.github/copilot-instructions.md': '# Copilot\n',
    '.github/instructions/tooling.instructions.md':
      "---\ndescription: Tools\napplyTo: 'scripts/**'\n---\n# Tools\n",
    '.github/skills/review-maintenance/SKILL.md':
      '---\nname: review-maintenance\ndescription: Review\n---\n# Review\n',
    '.github/skills/validate-changes/SKILL.md':
      '---\nname: validate-changes\ndescription: Validate\n---\n# Validate\n',
    '.github/prompts/validation-repair.prompt.md':
      '---\ndescription: Repair\nmode: agent\n---\n# Repair\n## Inputs\n',
    '.github/agent-rules/learned-rules.json': JSON.stringify({
      schemaVersion: 1,
      maxActiveRules: 2,
      rules: [
        {
          id: 'valid-active-rule',
          state: 'active',
          summary: 'A valid active rule with enough evidence for the fixture.',
          appliesTo: ['scripts/**'],
          evidence: [
            { type: 'test', path: 'AGENTS.md', note: 'Fixture test evidence.' },
            {
              type: 'instruction',
              path: '.github/instructions/tooling.instructions.md',
              note: 'Fixture instruction evidence.',
            },
          ],
          promotion: { approvedBy: 'fixture owner', date: '2026-09-18' },
        },
      ],
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await checkAgentCorpus(root);
  assert.ok(result.errors.some((error) => error.includes('"Procedure" section')));
  assert.ok(result.errors.some((error) => error.includes('"Guardrails" section')));
});

test('learned rules require lifecycle states, bounded active rules, and independent evidence', async (t) => {
  const root = await writeFiles({
    'AGENTS.md': '# Guide\n',
    '.github/copilot-instructions.md': '# Copilot\n',
    '.github/instructions/tooling.instructions.md':
      "---\ndescription: Tools\napplyTo: 'scripts/**'\n---\n# Tools\n",
    '.github/skills/review-maintenance/SKILL.md':
      '---\nname: review-maintenance\ndescription: Review\n---\n# Review\n',
    '.github/skills/validate-changes/SKILL.md':
      '---\nname: validate-changes\ndescription: Validate\n---\n# Validate\n',
    '.github/prompts/validation-repair.prompt.md':
      '---\ndescription: Repair\nmode: agent\n---\n# Repair\n## Inputs\n## Procedure\n## Guardrails\n',
    '.github/agent-rules/learned-rules.json': JSON.stringify({
      schemaVersion: 1,
      maxActiveRules: 0,
      rules: [
        {
          id: 'invalid-active-rule',
          state: 'active',
          summary: 'This active rule lacks repeated independent evidence.',
          appliesTo: ['scripts/**'],
          evidence: [{ type: 'test', path: 'missing.md', note: 'Missing path evidence.' }],
          promotion: { approvedBy: '', date: 'not-a-date' },
        },
        {
          id: 'retired-rule',
          state: 'retired',
          summary: 'This retired rule lacks the required retirement explanation.',
          appliesTo: ['docs/**'],
          evidence: [{ type: 'decision', path: 'AGENTS.md', note: 'Fixture decision.' }],
        },
      ],
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await checkAgentCorpus(root);
  assert.ok(result.errors.some((error) => error.includes('maxActiveRules')));
  assert.ok(result.errors.some((error) => error.includes('independent evidence')));
  assert.ok(result.errors.some((error) => error.includes('promotion approval')));
  assert.ok(result.errors.some((error) => error.includes('retiredReason')));
  assert.ok(result.errors.some((error) => error.includes('missing.md')));
});

test('learned-rule corpus rejects unknown fields from the published contract', async (t) => {
  const root = await writeFiles({
    'AGENTS.md': '# Guide\n',
    '.github/copilot-instructions.md': '# Copilot\n',
    '.github/instructions/tooling.instructions.md':
      "---\ndescription: Tools\napplyTo: 'scripts/**'\n---\n# Tools\n",
    '.github/skills/review-maintenance/SKILL.md':
      '---\nname: review-maintenance\ndescription: Review\n---\n# Review\n',
    '.github/skills/validate-changes/SKILL.md':
      '---\nname: validate-changes\ndescription: Validate\n---\n# Validate\n',
    '.github/prompts/validation-repair.prompt.md':
      '---\ndescription: Repair\nmode: agent\n---\n# Repair\n## Inputs\n## Procedure\n## Guardrails\n',
    '.github/agent-rules/learned-rules.json': JSON.stringify({
      schemaVersion: 1,
      maxActiveRules: 3,
      unexpectedRoot: true,
      rules: [
        {
          id: 'unknown-field-rule',
          state: 'active',
          summary: 'This otherwise valid active rule includes unknown JSON fields.',
          appliesTo: ['scripts/**'],
          unexpectedRule: true,
          evidence: [
            {
              type: 'test',
              path: 'AGENTS.md',
              note: 'Fixture test evidence.',
              unexpectedEvidence: true,
            },
            {
              type: 'instruction',
              path: '.github/instructions/tooling.instructions.md',
              note: 'Fixture instruction evidence.',
            },
          ],
          promotion: {
            approvedBy: 'fixture owner',
            date: '2026-09-18',
            unexpectedPromotion: true,
          },
        },
      ],
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await checkAgentCorpus(root);
  for (const field of [
    'unexpectedRoot',
    'unexpectedRule',
    'unexpectedEvidence',
    'unexpectedPromotion',
  ]) {
    assert.ok(result.errors.some((error) => error.includes(`unknown field "${field}"`)));
  }
});

test('learned-rule readers reject symlinked corpus files before parsing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-corpus-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'parallel-agents-outside-corpus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, '.github', 'agent-rules'), { recursive: true });
  const outsideRules = join(outside, 'learned-rules.json');
  await writeFile(
    outsideRules,
    JSON.stringify({
      schemaVersion: 1,
      maxActiveRules: 1,
      rules: [
        {
          id: 'outside-active-rule',
          state: 'active',
          summary: 'This outside active rule must not be consumed.',
          appliesTo: ['scripts/**'],
          evidence: [{ type: 'test', path: 'AGENTS.md', note: 'Outside fixture.' }],
          promotion: { approvedBy: 'outside', date: '2026-09-18' },
        },
      ],
    }),
    'utf8',
  );
  const linkedRules = join(root, '.github', 'agent-rules', 'learned-rules.json');
  if (!(await createSymlinkOrSkip(t, outsideRules, linkedRules, 'file'))) return;

  await assert.rejects(() => readActiveLearnedRules(root), /symbolic link|outside the repository/i);
});

test('agent corpus discovery rejects symlinked corpus directories', async (t) => {
  const root = await writeFiles({
    'AGENTS.md': '# Guide\n',
    '.github/copilot-instructions.md': '# Copilot\n',
    '.github/instructions/tooling.instructions.md':
      "---\ndescription: Tools\napplyTo: 'scripts/**'\n---\n# Tools\n",
    '.github/skills/review-maintenance/SKILL.md':
      '---\nname: review-maintenance\ndescription: Review\n---\n# Review\n',
    '.github/skills/validate-changes/SKILL.md':
      '---\nname: validate-changes\ndescription: Validate\n---\n# Validate\n',
    '.github/agent-rules/learned-rules.json': JSON.stringify({
      schemaVersion: 1,
      maxActiveRules: 1,
      rules: [
        {
          id: 'valid-active-rule',
          state: 'active',
          summary: 'A valid active rule with enough evidence for the fixture.',
          appliesTo: ['scripts/**'],
          evidence: [
            { type: 'test', path: 'AGENTS.md', note: 'Fixture test evidence.' },
            {
              type: 'instruction',
              path: '.github/instructions/tooling.instructions.md',
              note: 'Fixture instruction evidence.',
            },
          ],
          promotion: { approvedBy: 'fixture owner', date: '2026-09-18' },
        },
      ],
    }),
  });
  const outside = await mkdtemp(join(tmpdir(), 'parallel-agents-outside-prompts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(
    join(outside, 'validation-repair.prompt.md'),
    '---\ndescription: External prompt\nmode: agent\n---\n# Repair\n## Inputs\n## Procedure\n## Guardrails\n',
    'utf8',
  );
  await rm(join(root, '.github', 'prompts'), { recursive: true, force: true });
  if (!(await createSymlinkOrSkip(t, outside, join(root, '.github', 'prompts'), 'junction'))) {
    return;
  }

  const result = await checkAgentCorpus(root);
  assert.ok(
    result.errors.some((error) =>
      error.includes('.github/prompts: agent corpus directory must not be a symbolic link'),
    ),
  );
});

test('later agent runs consume only active learned rules', async () => {
  const active = await readActiveLearnedRules();
  assert.ok(active.length >= 1);
  assert.ok(active.every((rule) => rule.id !== 'agent-corpus-schema-rollout'));
  assert.ok(active.every((rule) => rule.id !== 'score-only-placeholder-docs'));
});
