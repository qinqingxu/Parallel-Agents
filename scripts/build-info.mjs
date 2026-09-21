import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function getBuildInfo(root) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !version) throw new Error('Package version is missing.');
  if (!existsSync(join(root, '.git'))) return { version, commit: null, dirty: false };
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  return {
    version,
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0,
  };
}
