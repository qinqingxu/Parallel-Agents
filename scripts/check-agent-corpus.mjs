import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requiredFiles = [
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.github/instructions/tooling.instructions.md',
  '.github/skills/review-maintenance/SKILL.md',
  '.github/skills/validate-changes/SKILL.md',
  '.github/prompts/validation-repair.prompt.md',
];
const promptDirectory = '.github/prompts';
const skillDirectory = '.github/skills';
const instructionDirectory = '.github/instructions';
const learnedRulesFile = '.github/agent-rules/learned-rules.json';
const validPromptModes = new Set(['agent', 'ask', 'edit']);
const validRuleStates = new Set(['candidate', 'active', 'retired']);
const validEvidenceTypes = new Set(['decision', 'implementation', 'instruction', 'test']);
const corpusFields = new Set(['schemaVersion', 'maxActiveRules', 'rules']);
const ruleFields = new Set([
  'id',
  'state',
  'summary',
  'appliesTo',
  'evidence',
  'promotion',
  'retiredReason',
]);
const evidenceFields = new Set(['type', 'path', 'note']);
const promotionFields = new Set(['approvedBy', 'date']);

function toPortable(path) {
  return path.split(sep).join('/');
}

function isInside(base, path) {
  const suffix = relative(base, path);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function parseFrontmatter(file, text, errors) {
  if (!text.startsWith('---\n')) {
    errors.push(`${file}:1: missing YAML frontmatter.`);
    return null;
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    errors.push(`${file}:1: unterminated YAML frontmatter.`);
    return null;
  }
  const fields = new Map();
  for (const [index, rawLine] of text.slice(4, end).split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      errors.push(`${file}:${index + 2}: unsupported frontmatter syntax.`);
      continue;
    }
    if (fields.has(match[1])) errors.push(`${file}:${index + 2}: duplicate "${match[1]}" field.`);
    fields.set(match[1], match[2].replace(/^['"]|['"]$/g, '').trim());
  }
  return fields;
}

async function readText(root, file, errors) {
  try {
    return await readFile(resolve(root, file), 'utf8');
  } catch (error) {
    errors.push(
      `${file}: cannot read required agent corpus file (${error.code ?? error.message}).`,
    );
    return '';
  }
}

async function assertContainedFile(root, file, errors) {
  const target = resolve(root, file);
  try {
    const linkInfo = await lstat(target);
    if (linkInfo.isSymbolicLink()) {
      errors.push(`${file}: required agent corpus file must not be a symbolic link.`);
      return;
    }
    const canonical = await realpath(target);
    if (!isInside(root, canonical)) {
      errors.push(`${file}: resolves outside the repository.`);
      return;
    }
    const info = await stat(canonical);
    if (!info.isFile()) errors.push(`${file}: expected a regular file.`);
  } catch (error) {
    errors.push(`${file}: missing required agent corpus file (${error.code ?? error.message}).`);
  }
}

async function assertContainedDirectory(root, directory, errors) {
  const target = resolve(root, directory);
  try {
    const linkInfo = await lstat(target);
    if (linkInfo.isSymbolicLink()) {
      errors.push(`${directory}: agent corpus directory must not be a symbolic link.`);
      return false;
    }
    const canonical = await realpath(target);
    if (!isInside(root, canonical)) {
      errors.push(`${directory}: resolves outside the repository.`);
      return false;
    }
    const info = await stat(canonical);
    if (!info.isDirectory()) {
      errors.push(`${directory}: expected a directory.`);
      return false;
    }
    return true;
  } catch (error) {
    errors.push(`${directory}: missing agent corpus directory (${error.code ?? error.message}).`);
    return false;
  }
}

function checkAllowedFields(value, allowed, prefix, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${prefix} has unknown field "${key}".`);
  }
}

function lineForJsonKey(text, key) {
  const index = text.indexOf(`"${key}"`);
  return index === -1 ? 1 : text.slice(0, index).split('\n').length;
}

async function checkReferencedPath(root, file, evidencePath, errors) {
  if (typeof evidencePath !== 'string' || !evidencePath.trim()) {
    errors.push(`${file}: evidence path must be a nonempty repository-relative string.`);
    return;
  }
  if (/^[a-z]:[\\/]|^\\\\|^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(evidencePath)) {
    errors.push(`${file}: evidence path "${evidencePath}" must be repository-relative.`);
    return;
  }
  if (evidencePath.includes('\0')) {
    errors.push(`${file}: evidence path "${evidencePath}" contains a null byte.`);
    return;
  }
  const target = resolve(root, evidencePath);
  if (!isInside(root, target)) {
    errors.push(`${file}: evidence path "${evidencePath}" escapes the repository.`);
    return;
  }
  await assertContainedFile(root, evidencePath, errors);
}

function emptyRules() {
  return { activeRules: [], candidateRules: [], retiredRules: [] };
}

function parseCorpusObject(text, errors) {
  try {
    const corpus = JSON.parse(text);
    if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) {
      errors.push(`${learnedRulesFile}: expected a JSON object.`);
      return null;
    }
    return corpus;
  } catch (error) {
    errors.push(`${learnedRulesFile}: invalid JSON (${error.message}).`);
    return null;
  }
}

function checkCorpusHeader(corpus, errors) {
  checkAllowedFields(corpus, corpusFields, learnedRulesFile, errors);
  if (corpus.schemaVersion !== 1) errors.push(`${learnedRulesFile}: schemaVersion must be 1.`);
  if (!Number.isInteger(corpus.maxActiveRules) || corpus.maxActiveRules < 1) {
    errors.push(`${learnedRulesFile}: maxActiveRules must be a positive integer.`);
  }
  if (!Array.isArray(corpus.rules) || corpus.rules.length === 0) {
    errors.push(`${learnedRulesFile}: rules must be a nonempty array.`);
  }
}

function checkRuleIdentity(rule, prefix, ids, byState, errors) {
  if (!/^[a-z0-9][a-z0-9-]{5,80}$/.test(rule.id)) {
    errors.push(`${prefix} has invalid id.`);
  } else if (ids.has(rule.id)) {
    errors.push(`${prefix} duplicates id "${rule.id}".`);
  } else {
    ids.add(rule.id);
  }
  if (!validRuleStates.has(rule.state)) {
    errors.push(`${prefix} has invalid state.`);
  } else {
    byState.get(rule.state).push(rule);
  }
}

function checkRuleScope(rule, prefix, errors) {
  if (typeof rule.summary !== 'string' || rule.summary.trim().length < 20)
    errors.push(`${prefix} requires a meaningful summary.`);
  if (!Array.isArray(rule.appliesTo) || rule.appliesTo.length === 0) {
    errors.push(`${prefix} requires nonempty appliesTo globs.`);
  } else if (
    rule.appliesTo.some((glob) => typeof glob !== 'string' || !glob.trim() || glob.includes('..'))
  ) {
    errors.push(`${prefix} has an invalid appliesTo entry.`);
  }
}

async function checkEvidence(root, rule, prefix, errors) {
  if (!Array.isArray(rule.evidence) || rule.evidence.length === 0) {
    errors.push(`${prefix} requires evidence.`);
    return;
  }
  const evidenceTypes = new Set();
  for (const [evidenceIndex, evidence] of rule.evidence.entries()) {
    const evidencePrefix = `${prefix} evidence ${evidenceIndex + 1}`;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      errors.push(`${evidencePrefix} must be an object.`);
      continue;
    }
    checkAllowedFields(evidence, evidenceFields, evidencePrefix, errors);
    if (!validEvidenceTypes.has(evidence.type)) errors.push(`${evidencePrefix} has invalid type.`);
    else evidenceTypes.add(evidence.type);
    await checkReferencedPath(root, learnedRulesFile, evidence.path, errors);
    if (typeof evidence.note !== 'string' || evidence.note.trim().length < 10)
      errors.push(`${evidencePrefix} requires a note.`);
  }
  if (rule.state === 'active' && (rule.evidence.length < 2 || evidenceTypes.size < 2)) {
    errors.push(`${prefix} active rules require at least two independent evidence types.`);
  }
}

function checkRuleLifecycle(rule, prefix, errors) {
  if (rule.state === 'active') {
    const promotion = rule.promotion;
    if (
      !promotion ||
      typeof promotion !== 'object' ||
      Array.isArray(promotion) ||
      typeof promotion.approvedBy !== 'string' ||
      !promotion.approvedBy.trim() ||
      Number.isNaN(Date.parse(promotion.date))
    ) {
      errors.push(`${prefix} active rules require promotion approval and date.`);
    } else {
      checkAllowedFields(promotion, promotionFields, `${prefix} promotion`, errors);
    }
  }
  if (
    rule.state === 'retired' &&
    (typeof rule.retiredReason !== 'string' || rule.retiredReason.trim().length < 20)
  ) {
    errors.push(`${prefix} retired rules require a retiredReason.`);
  }
}

async function checkRule(root, rule, index, ids, byState, errors) {
  const prefix = `${learnedRulesFile}: rule ${index + 1}`;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    errors.push(`${prefix} must be an object.`);
    return;
  }
  checkAllowedFields(rule, ruleFields, prefix, errors);
  checkRuleIdentity(rule, prefix, ids, byState, errors);
  checkRuleScope(rule, prefix, errors);
  await checkEvidence(root, rule, prefix, errors);
  checkRuleLifecycle(rule, prefix, errors);
}

async function parseLearnedRuleCorpus(root, errors) {
  const text = await readText(root, learnedRulesFile, errors);
  if (!text) return emptyRules();
  const corpus = parseCorpusObject(text, errors);
  if (!corpus) return emptyRules();
  checkCorpusHeader(corpus, errors);
  if (!Array.isArray(corpus.rules) || corpus.rules.length === 0) return emptyRules();
  const ids = new Set();
  const byState = new Map([...validRuleStates].map((state) => [state, []]));
  for (const [index, rule] of corpus.rules.entries()) {
    await checkRule(root, rule, index, ids, byState, errors);
  }
  const activeRules = byState.get('active');
  const candidateRules = byState.get('candidate');
  const retiredRules = byState.get('retired');
  if (Number.isInteger(corpus.maxActiveRules) && activeRules.length > corpus.maxActiveRules) {
    errors.push(
      `${learnedRulesFile}:${lineForJsonKey(text, 'maxActiveRules')}: active rule count ${activeRules.length} exceeds maxActiveRules ${corpus.maxActiveRules}.`,
    );
  }
  return { activeRules, candidateRules, retiredRules };
}

async function discoverMarkdown(root, directory, suffix, errors) {
  const base = resolve(root, directory);
  if (!(await assertContainedDirectory(root, directory, errors))) return [];
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (error) {
    errors.push(
      `${directory}: cannot read agent corpus directory (${error.code ?? error.message}).`,
    );
    return [];
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = toPortable(join(directory, entry.name));
    if (entry.isSymbolicLink()) {
      errors.push(`${file}: agent corpus entries must not be symbolic links.`);
    } else if (entry.isDirectory()) {
      files.push(...(await discoverMarkdown(root, file, suffix, errors)));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(file);
    }
  }
  return files;
}

async function checkPrompt(root, file, errors) {
  const text = await readText(root, file, errors);
  const fields = parseFrontmatter(file, text, errors);
  if (!fields) return;
  if (!fields.get('description')) errors.push(`${file}: frontmatter requires a description.`);
  if (!validPromptModes.has(fields.get('mode'))) {
    errors.push(`${file}: frontmatter mode must be one of ${[...validPromptModes].join(', ')}.`);
  }
  if (!/^#\s+\S/m.test(text)) errors.push(`${file}: prompt must have a top-level heading.`);
  for (const token of ['Inputs', 'Procedure', 'Guardrails']) {
    if (!text.includes(`## ${token}`))
      errors.push(`${file}: prompt must include a "${token}" section.`);
  }
}

async function checkSkill(root, file, errors) {
  const text = await readText(root, file, errors);
  const fields = parseFrontmatter(file, text, errors);
  if (!fields) return;
  for (const name of ['name', 'description']) {
    if (!fields.get(name)) errors.push(`${file}: frontmatter requires "${name}".`);
  }
  if (!/^#\s+\S/m.test(text)) errors.push(`${file}: skill must have a top-level heading.`);
}

async function checkInstruction(root, file, errors) {
  const text = await readText(root, file, errors);
  const fields = parseFrontmatter(file, text, errors);
  if (!fields) return;
  if (!fields.get('description')) errors.push(`${file}: frontmatter requires a description.`);
  if (!fields.get('applyTo')) errors.push(`${file}: frontmatter requires applyTo.`);
  if (!/^#\s+\S/m.test(text)) errors.push(`${file}: instruction must have a top-level heading.`);
}

export async function checkAgentCorpus(targetRoot = repositoryRoot) {
  const root = await realpath(targetRoot);
  const errors = [];
  for (const file of requiredFiles) await assertContainedFile(root, file, errors);
  await assertContainedFile(root, learnedRulesFile, errors);
  const prompts = await discoverMarkdown(root, promptDirectory, '.prompt.md', errors);
  const skills = await discoverMarkdown(root, skillDirectory, 'SKILL.md', errors);
  const instructions = await discoverMarkdown(
    root,
    instructionDirectory,
    '.instructions.md',
    errors,
  );
  if (!prompts.length) errors.push(`${promptDirectory}: expected at least one reusable prompt.`);
  if (!skills.length) errors.push(`${skillDirectory}: expected at least one repository skill.`);
  if (!instructions.length)
    errors.push(`${instructionDirectory}: expected at least one path-scoped instruction.`);
  for (const file of prompts) await checkPrompt(root, file, errors);
  for (const file of skills) await checkSkill(root, file, errors);
  for (const file of instructions) await checkInstruction(root, file, errors);
  const learnedRules = await parseLearnedRuleCorpus(root, errors);
  return { errors, prompts, skills, instructions, learnedRules };
}

export async function readActiveLearnedRules(targetRoot = repositoryRoot) {
  const errors = [];
  const root = await realpath(targetRoot);
  await assertContainedFile(root, learnedRulesFile, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  const learnedRules = await parseLearnedRuleCorpus(root, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  return learnedRules.activeRules.map((rule) => ({
    id: rule.id,
    summary: rule.summary,
    appliesTo: rule.appliesTo,
  }));
}

async function main() {
  const result = await checkAgentCorpus();
  for (const error of result.errors) console.error(error);
  console.log(
    `Checked ${result.prompts.length} prompt(s), ${result.skills.length} skill(s), ${result.instructions.length} instruction file(s), and ${result.learnedRules.activeRules.length} active learned rule(s).`,
  );
  if (result.errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
