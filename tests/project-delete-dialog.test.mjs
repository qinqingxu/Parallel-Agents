import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('project deletion initially requires acknowledgement but never project-name typing', async () => {
  const result = await build({
    entryPoints: ['src/renderer/components/ProjectDeleteDialog.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const html = renderToStaticMarkup(
    createElement(module.exports.ProjectDeleteDialog, {
      projects: [
        { id: 'codex:repo', agent: 'codex', displayName: 'Nexus workspace', realPath: 'C:\\Nexus' },
      ],
      onConfirm: async () => {
        throw new Error('Must not delete before confirmation');
      },
      onCancel() {},
    }),
  );
  assert.match(html, /project-delete-name[^>]*>Nexus workspace</);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /type="text"|Type <code>/);
  assert.match(html, /type="submit"[^>]*disabled/);
  assert.match(html, /Working folders are not deleted/);
});
