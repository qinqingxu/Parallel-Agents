import { stripVTControlCharacters } from 'node:util';

import { decodeText } from '../maintenance/filesystem.mjs';
import { fail, relativePath } from '../maintenance/policy.mjs';
import { LOOP_LIMITS, sha256 } from './contract.mjs';

export const PROGRESS_LIMITS = Object.freeze({
  maxStdoutBytes: LOOP_LIMITS.maxOutputBytes,
  maxLines: 20_000,
  maxLineChars: 4096,
  maxRecentResults: 12,
  maxSlowResults: 5,
  maxMatches: 4,
  maxFileSummaries: 64,
  maxCatalogueFiles: 128,
  maxDeclarations: 4096,
  maxSourceFileBytes: 1024 * 1024,
  maxSourceBytes: 4 * 1024 * 1024,
  maxArtifactBytes: 256 * 1024,
});

export async function buildTestCatalogue(entries) {
  const selected = entries
    .filter(({ path, kind }) => kind === 'file' && /^tests\/[^/]+\.test\.mjs$/u.test(path))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (selected.length > PROGRESS_LIMITS.maxCatalogueFiles) {
    fail('limit-exceeded', 'The static test catalogue exceeds its file bound.');
  }
  const { default: ts } = await import('typescript');
  const files = [];
  const titles = new Map();
  const declarations = [];
  let bytes = 0;
  let staticTests = 0;
  let dynamicTests = 0;
  let parseDiagnostics = 0;
  for (const entry of selected) {
    relativePath(entry.path);
    bytes += entry.content.length;
    if (
      entry.content.length > PROGRESS_LIMITS.maxSourceFileBytes ||
      bytes > PROGRESS_LIMITS.maxSourceBytes
    ) {
      fail('limit-exceeded', 'The static test catalogue exceeds its source byte bound.');
    }
    const source = ts.createSourceFile(
      entry.path,
      decodeText(entry.content, entry.path),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS,
    );
    const aliases = new Set();
    const namespaces = new Set();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'node:test')
        continue;
      const clause = statement.importClause;
      if (clause?.name) aliases.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      else if (bindings) {
        for (const binding of bindings.elements) {
          if (['test', 'it', 'default'].includes(binding.propertyName?.text ?? binding.name.text)) {
            aliases.add(binding.name.text);
          }
        }
      }
    }
    const isTest = (expression) => {
      if (ts.isIdentifier(expression)) return aliases.has(expression.text);
      if (!ts.isPropertyAccessExpression(expression)) return false;
      if (['skip', 'todo', 'only'].includes(expression.name.text))
        return isTest(expression.expression);
      return (
        ts.isIdentifier(expression.expression) &&
        namespaces.has(expression.expression.text) &&
        ['test', 'it'].includes(expression.name.text)
      );
    };
    const file = {
      path: entry.path,
      sha256: sha256(entry.content),
      staticTests: 0,
      dynamicTests: 0,
    };
    const visit = (node) => {
      if (ts.isCallExpression(node) && isTest(node.expression)) {
        const title = node.arguments[0];
        if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
          const titleSha256 = sha256(title.text);
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const location = { file: entry.path, line };
          titles.set(titleSha256, [...(titles.get(titleSha256) ?? []), location]);
          declarations.push({ ...location, titleSha256 });
          file.staticTests += 1;
          staticTests += 1;
        } else {
          file.dynamicTests += 1;
          dynamicTests += 1;
        }
        if (staticTests + dynamicTests > PROGRESS_LIMITS.maxDeclarations) {
          fail('limit-exceeded', 'The static test catalogue exceeds its declaration bound.');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    parseDiagnostics += source.parseDiagnostics.length;
    files.push(file);
  }
  return {
    schemaVersion: 1,
    files,
    titles,
    staticTests,
    dynamicTests,
    parseDiagnostics,
    parser: 'typescript',
    parserVersion: ts.version,
    sha256: sha256(JSON.stringify({ files, declarations })),
  };
}

export function parseCheckProgress(stdout, catalogue) {
  if (
    !Buffer.isBuffer(stdout) ||
    catalogue?.schemaVersion !== 1 ||
    !Array.isArray(catalogue.files) ||
    !(catalogue.titles instanceof Map)
  ) {
    fail('invalid-progress-input', 'Progress requires captured bytes and a static test catalogue.');
  }
  const text = stdout.subarray(0, PROGRESS_LIMITS.maxStdoutBytes).toString('utf8');
  const observed = new Map(catalogue.files.map(({ path }) => [path, new Set()]));
  const formats = new Set();
  const progress = {
    schemaVersion: 1,
    scope: 'captured-stdout-observations-only',
    rawOutputStored: false,
    lastObservedStage: null,
    observedStages: [],
    formats: [],
    counts: { passed: 0, failed: 0, skipped: 0, todo: 0, unmapped: 0, ambiguous: 0 },
    reportedTotals: {},
    recentResults: [],
    slowestResults: [],
    files: [],
    catalogue: {
      sha256: catalogue.sha256,
      files: catalogue.files.length,
      staticTests: catalogue.staticTests,
      dynamicTests: catalogue.dynamicTests,
      parseDiagnostics: catalogue.parseDiagnostics,
      parser: catalogue.parser,
      parserVersion: catalogue.parserVersion,
    },
    capturedStdoutBytes: Math.min(stdout.length, PROGRESS_LIMITS.maxStdoutBytes),
    examinedLines: 0,
    truncated: {
      stdoutBytes: stdout.length > PROGRESS_LIMITS.maxStdoutBytes,
      lineCount: false,
      longLines: 0,
      partialFinalLine: text.length > 0 && !text.endsWith('\n'),
      fileSummaries: catalogue.files.length > PROGRESS_LIMITS.maxFileSummaries,
    },
    limits: { ...PROGRESS_LIMITS },
    limitations: [
      'Advisory observations only; process status and exit code remain the outcome authority.',
      'Reporter output can be buffered and file-ordered while tests run concurrently. The last observed result is not the stalled or currently running test.',
      'Source locations match static literal node:test declarations. Dynamic or duplicate titles may be unmapped or ambiguous; unobserved declarations are not proof that tests never started.',
      'Only captured stdout is parsed after process completion/termination. Stderr, raw titles, assertion diagnostics and absolute paths from output are not retained.',
    ],
  };
  const slowest = (result) => {
    if (result.durationMs === null) return;
    progress.slowestResults.push(result);
    progress.slowestResults.sort((left, right) => right.durationMs - left.durationMs);
    progress.slowestResults.length = Math.min(
      progress.slowestResults.length,
      PROGRESS_LIMITS.maxSlowResults,
    );
  };
  const record = (status, title, durationMs) => {
    const titleSha256 = sha256(title);
    const matches = catalogue.titles.get(titleSha256) ?? [];
    progress.counts[status] += 1;
    if (!matches.length) progress.counts.unmapped += 1;
    else if (matches.length > 1) progress.counts.ambiguous += 1;
    else observed.get(matches[0].file).add(`${matches[0].line}:${titleSha256}`);
    const result = {
      status,
      titleSha256,
      matches: matches.slice(0, PROGRESS_LIMITS.maxMatches),
      matchingDeclarations: matches.length,
      durationMs,
      outputLine: progress.examinedLines,
    };
    progress.recentResults.push(result);
    if (progress.recentResults.length > PROGRESS_LIMITS.maxRecentResults)
      progress.recentResults.shift();
    slowest(result);
    return result;
  };
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER
      ? parsed
      : null;
  };
  let offset = 0;
  let failureSummary = false;
  let tapResult;
  let tapDiagnostic = false;
  while (offset < text.length && progress.examinedLines < PROGRESS_LIMITS.maxLines) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) break;
    let line = text.slice(offset, newline).replace(/\r$/u, '');
    offset = newline + 1;
    progress.examinedLines += 1;
    if (line.length > PROGRESS_LIMITS.maxLineChars) {
      progress.truncated.longLines += 1;
      continue;
    }
    line = stripVTControlCharacters(line);
    const stage = line.match(
      /^> parallel-agents@\d+\.\d+\.\d+(?:[-+][a-z0-9.+-]+)? (check|lint|format:check|typecheck|test|check:docs|check:agent-corpus)$/iu,
    );
    if (stage) {
      const name = stage[1].toLowerCase();
      if (!progress.observedStages.includes(name)) progress.observedStages.push(name);
      progress.lastObservedStage = name;
      continue;
    }
    const total = line.match(
      /^(?:\u2139|#) (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (\d+(?:\.\d+)?)$/u,
    );
    if (total) {
      const value = number(total[2]);
      if (value !== null && (total[1] === 'duration_ms' || Number.isSafeInteger(value))) {
        progress.reportedTotals[total[1] === 'duration_ms' ? 'durationMs' : total[1]] = value;
      }
      continue;
    }
    if (line === '\u2716 failing tests:') failureSummary = true;
    if (failureSummary) continue;
    const spec = line.match(
      /^\s*([\u2714\u2716\ufe63-]) (.+?) \((\d+(?:\.\d+)?)ms\)(?: # (SKIP|TODO)(?: .*)?)?$/u,
    );
    if (spec) {
      formats.add('spec');
      const status =
        spec[4] === 'TODO'
          ? 'todo'
          : spec[4] === 'SKIP' || ['-', '\ufe63'].includes(spec[1])
            ? 'skipped'
            : spec[1] === '\u2714'
              ? 'passed'
              : 'failed';
      record(status, spec[2], number(spec[3]));
      tapResult = null;
      tapDiagnostic = false;
      continue;
    }
    const tap = line.match(/^\s*(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)(?: .*)?)?$/u);
    if (tap) {
      formats.add('tap');
      const status =
        tap[3] === 'SKIP'
          ? 'skipped'
          : tap[3] === 'TODO'
            ? 'todo'
            : tap[1] === 'ok'
              ? 'passed'
              : 'failed';
      tapResult = record(status, tap[2], null);
      tapDiagnostic = false;
      continue;
    }
    if (tapResult && /^\s+---$/u.test(line)) tapDiagnostic = true;
    const duration = tapResult && tapDiagnostic && line.match(/^\s+duration_ms: (\d+(?:\.\d+)?)$/u);
    if (duration && tapResult.durationMs === null) {
      tapResult.durationMs = number(duration[1]);
      slowest(tapResult);
    }
    if (/^\s+\.\.\.$/u.test(line)) {
      tapResult = null;
      tapDiagnostic = false;
    }
  }
  progress.truncated.lineCount =
    progress.examinedLines === PROGRESS_LIMITS.maxLines && offset < text.length;
  progress.formats = [...formats].sort();
  progress.files = catalogue.files.slice(0, PROGRESS_LIMITS.maxFileSummaries).map((file) => ({
    path: file.path,
    staticTests: file.staticTests,
    dynamicTests: file.dynamicTests,
    observedStaticTests: observed.get(file.path).size,
    unobservedStaticTests: file.staticTests - observed.get(file.path).size,
  }));
  if (Buffer.byteLength(JSON.stringify(progress)) > PROGRESS_LIMITS.maxArtifactBytes) {
    fail('limit-exceeded', 'Parsed progress exceeds its artifact byte bound.');
  }
  return progress;
}
