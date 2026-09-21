import { isAbsolute, matchesGlob, win32 } from 'node:path';

export const LIMITS = Object.freeze({
  maxCandidates: 128,
  maxFileBytes: 256 * 1024,
  maxCandidateBytes: 4 * 1024 * 1024,
  maxInventoryEntries: 10_000,
  maxInventoryBytes: 2 * 1024 * 1024,
  maxProtectedFileBytes: 16 * 1024 * 1024,
  maxProtectedBytes: 128 * 1024 * 1024,
  maxConfigBytes: 32 * 1024,
  gitTimeoutMs: 10_000,
  formattingTimeoutMs: 15_000,
  validationTimeoutMs: 180_000,
  maxValidationOutputBytes: 1024 * 1024,
});

export class MaintenanceError extends Error {
  constructor(code, message, path) {
    super(message);
    this.name = 'MaintenanceError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

export function fail(code, message, path) {
  throw new MaintenanceError(code, message, path);
}

export function limitsFor(overrides = {}) {
  for (const [name, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(LIMITS, name) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > LIMITS[name]
    ) {
      fail('invalid-options', 'Limits may only lower a documented positive integer cap.');
    }
  }
  return { ...LIMITS, ...overrides };
}

function unsafeCharacters(text) {
  return [...text].some(
    (character) =>
      character === '\\' ||
      character === ':' ||
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127,
  );
}

export function relativePath(path) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 1024 ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    unsafeCharacters(path) ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/u.test(part) ||
          /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part),
      )
  ) {
    fail('unsafe-path', 'A path is not a safe repository-relative name.');
  }
  return path;
}

const rootDocs = new Set([
  'readme.md',
  'agents.md',
  'architecture.md',
  'contributing.md',
  'code_of_conduct.md',
  'security.md',
  'spec.md',
  'support.md',
  'changelog.md',
]);
const deniedSegments = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.vite',
  '.claude',
  '.codex',
  '.copilot',
  '.gemini',
  'node_modules',
  'src',
  'resources',
  'scripts',
  'tests',
  'out',
  'dist',
  'release',
  'build',
  'coverage',
  'reports',
  'hackathon',
  'superpowers',
  'archive',
  'archives',
  'generated',
  '_generated',
  '_site',
  'vendor',
  'user-data',
  'userdata',
]);

export function candidatePath(path) {
  const lower = path.toLowerCase();
  if (
    lower.split('/').some((part) => deniedSegments.has(part)) ||
    lower
      .split('/')
      .some((part, index) => part.startsWith('.') && !(index === 0 && part === '.github')) ||
    /(?:\.generated|\.min)\./u.test(lower)
  ) {
    return false;
  }
  return (
    rootDocs.has(lower) ||
    (lower.startsWith('docs/') && lower.endsWith('.md')) ||
    (lower.startsWith('.github/') && /\.(?:md|ya?ml)$/u.test(lower))
  );
}

export function candidateTree(path) {
  const lower = path.toLowerCase();
  return (
    rootDocs.has(lower) ||
    lower === 'docs' ||
    lower.startsWith('docs/') ||
    lower === '.github' ||
    lower.startsWith('.github/')
  );
}

export function protectedPath(path) {
  const lower = path.toLowerCase();
  return (
    /^(?:src|resources|scripts|tests)(?:\/|$)/u.test(lower) ||
    /(?:^|\/)\.(?:gitignore|gitattributes|prettierignore)$/u.test(lower) ||
    (!lower.includes('/') &&
      /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|.*\.(?:[cm]?js|tsx?|json))$/u.test(
        lower,
      ))
  );
}

export function generatedHeader(text) {
  return /(?:@generated\b|auto[- ]generated\b|automatically generated\b|generated[^\n]*do not edit)/iu.test(
    text.slice(0, 8192),
  );
}

function patterns(value, name) {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(
      (pattern) =>
        typeof pattern !== 'string' ||
        pattern.length === 0 ||
        pattern.length > 256 ||
        unsafeCharacters(pattern) ||
        pattern.startsWith('/') ||
        pattern.split('/').some((part) => part === '..' || part === '.'),
    )
  ) {
    fail(
      'invalid-policy',
      `${name} must contain at most 64 safe repository-relative glob patterns.`,
    );
  }
  return value;
}

export function parsePolicy(text) {
  let policy;
  try {
    policy = JSON.parse(text);
  } catch {
    fail('invalid-policy', 'Maintenance policy must be valid JSON.', '.github/maintenance.json');
  }
  if (
    !policy ||
    policy.version !== 1 ||
    Object.keys(policy).some((key) => !['version', 'include', 'exclude'].includes(key))
  ) {
    fail('invalid-policy', 'Only version 1, include, and exclude are supported.');
  }
  return {
    include: patterns(policy.include ?? ['**/*'], 'include'),
    exclude: patterns(policy.exclude ?? [], 'exclude'),
  };
}

export function excludedByPolicy(path, policy) {
  return policy.exclude.some((pattern) => matchesPattern(path, pattern));
}

export function includedByPolicy(path, policy) {
  return candidatePath(path) && policy.include.some((pattern) => matchesPattern(path, pattern));
}

function matchesPattern(path, pattern) {
  return pattern === '**' || pattern === '**/*' || matchesGlob(path, pattern);
}

const optionTypes = {
  singleQuote: 'boolean',
  semi: 'boolean',
  bracketSpacing: 'boolean',
  useTabs: 'boolean',
  printWidth: 'number',
  tabWidth: 'number',
  trailingComma: ['all', 'es5', 'none'],
  proseWrap: ['always', 'never', 'preserve'],
  endOfLine: ['lf', 'crlf', 'cr', 'auto'],
  htmlWhitespaceSensitivity: ['css', 'strict', 'ignore'],
  embeddedLanguageFormatting: ['off', 'auto'],
};

export function parseFormatOptions(text) {
  let config;
  try {
    config = text === undefined ? {} : JSON.parse(text);
  } catch {
    fail('invalid-formatter-config', 'The root .prettierrc.json must be valid JSON.');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('invalid-formatter-config', 'The root Prettier configuration must be an object.');
  }
  for (const [key, value] of Object.entries(config)) {
    const type = optionTypes[key];
    if (
      !type ||
      (Array.isArray(type) ? !type.includes(value) : typeof value !== type) ||
      (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1 || value > 1000))
    ) {
      fail('invalid-formatter-config', 'Only supported data-only Prettier options are permitted.');
    }
  }
  return { endOfLine: 'lf', ...config, embeddedLanguageFormatting: 'off' };
}
