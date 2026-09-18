import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

test('later agent runs consume only active learned rules', async () => {
  const active = await readActiveLearnedRules();
  assert.ok(active.length >= 1);
  assert.ok(active.every((rule) => rule.id !== 'agent-corpus-schema-rollout'));
  assert.ok(active.every((rule) => rule.id !== 'score-only-placeholder-docs'));
});
