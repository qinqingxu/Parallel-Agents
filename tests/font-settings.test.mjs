import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build, transform } from 'esbuild';

const require = createRequire(import.meta.url);
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

async function createStore(config) {
  const result = await build({
    entryPoints: ['src/renderer/store/app-store.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'commands-without-images',
        setup(builder) {
          builder.onResolve({ filter: /icons\/agentIcons$/ }, () => ({
            path: 'icons',
            namespace: 'commands',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'commands' }, () => ({
            contents:
              'export const startCommandFor=()=>""; export const resumeCommandFor=()=>""; export const extraPathFor=()=>[];',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  const styles = {};
  new Function('require', 'module', 'exports', 'window', 'document', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
    { api: { config } },
    {
      documentElement: {
        style: {
          setProperty: (name, value) => {
            styles[name] = value;
          },
        },
      },
    },
  );
  return { store: module.exports.useAppStore, styles };
}

test('bold loads from saved settings and changes only after successful persistence', async () => {
  let saved = true;
  let fail = false;
  let calls = 0;
  const { store, styles } = await createStore({
    getFontSize: async () => 18,
    getFontBold: async () => saved,
    getConfirmOnCloseTab: async () => true,
    getTerminalMultilineEnter: async () => true,
    getTerminalCopyPaste: async () => true,
    setFontBold: async (value) => {
      calls++;
      if (fail) throw new Error('Write failed');
      saved = value;
    },
  });
  assert.equal(store.getState().fontBold, false);
  await store.getState().loadSettings();
  assert.equal(store.getState().fontBold, true);
  assert.equal(styles['--app-font-weight'], '700');
  assert.equal(styles['--app-font-size'], '18px');
  const pending = store.getState().setFontBold(false);
  assert.equal(store.getState().fontBold, true);
  await pending;
  assert.equal(store.getState().fontBold, false);
  assert.equal(styles['--app-font-weight'], '400');
  fail = true;
  await assert.rejects(store.getState().setFontBold(true), /Write failed/);
  assert.equal(store.getState().fontBold, false);
  assert.equal(styles['--app-font-weight'], '400');
  for (const invalid of [undefined, null, 0, 'true', {}]) {
    await assert.rejects(store.getState().setFontBold(invalid), /boolean/);
  }
  assert.equal(calls, 2);
});

// Run component hooks across renders, with native terminal/editor boundaries mocked.
async function componentHarness(name, state, api = {}, dependencies = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: index === 0 && name === 'TerminalPane' ? {} : initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
    lazy: () => 'MockDiffEditor',
    Suspense: 'Suspense',
  };
  const useAppStore = Object.assign((selector) => selector(state), { getState: () => state });
  const { code } = await transform(await source(`renderer/components/${name}.tsx`), {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function(
    'require',
    'module',
    'exports',
    'window',
    'ResizeObserver',
    'requestAnimationFrame',
    code,
  )(
    (id) => {
      if (id === 'react') return react;
      if (id === '../store/app-store') return { useAppStore };
      if (id === '../../shared/typography')
        return {
          TERMINAL_FONT_FAMILY: 'monospace',
          DEFAULT_FONT_SIZE: 14,
          MIN_FONT_SIZE: 10,
          MAX_FONT_SIZE: 24,
        };
      return dependencies[id] ?? require(id);
    },
    module,
    module.exports,
    { api, addEventListener() {}, removeEventListener() {} },
    class {
      observe() {}
      disconnect() {}
    },
    (callback) => callback(),
  );
  return (props = {}) => {
    cursor = 0;
    effects = [];
    const tree = module.exports[name](props);
    effects.forEach((effect) => effect());
    return tree;
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  const children = [tree.props?.children].flat(Infinity);
  for (const child of children) {
    const result = find(child, predicate);
    if (result) return result;
  }
}

test('terminal changes normal weight live without recreating PTY or changing ANSI bold weight', async () => {
  const terminals = [];
  let spawns = 0;
  let fits = 0;
  let disposed = 0;
  let onData;
  const state = { fontBold: false, fontSize: 14, theme: 'dark' };
  const render = await componentHarness(
    'TerminalPane',
    state,
    {
      pty: {
        spawn: async () => {
          spawns++;
        },
        resize: async () => {},
        onData: (listener) => {
          onData = listener;
          return () => {};
        },
        onExit: () => () => {},
      },
    },
    {
      '@xterm/xterm': {
        Terminal: class {
          constructor(options) {
            this.options = options;
            this.cols = 80;
            this.rows = 24;
            this.written = [];
            terminals.push(this);
          }
          loadAddon() {}
          open() {}
          attachCustomKeyEventHandler() {}
          onData() {}
          focus() {}
          write(data) {
            this.written.push(data);
          }
          dispose() {
            disposed++;
          }
        },
      },
      '@xterm/addon-fit': {
        FitAddon: class {
          fit() {
            fits++;
          }
        },
      },
      '@xterm/addon-web-links': { WebLinksAddon: class {} },
    },
  );
  const props = { terminalKey: 'session', cwd: 'C:\\repo', visible: true };
  render(props);
  const terminal = terminals[0];
  assert.equal(terminal.options.fontWeight, 400);
  assert.equal(terminal.options.fontWeightBold, 700);
  for (const bold of [true, false]) {
    state.fontBold = bold;
    render(props);
    assert.equal(terminal.options.fontWeight, bold ? 700 : 400);
    assert.equal(terminal.options.fontWeightBold, 700);
  }
  onData('session', '\x1b[1mANSI bold\x1b[0m');
  assert.deepEqual(terminal.written, ['\x1b[1mANSI bold\x1b[0m']);
  const beforeHidden = fits;
  state.fontBold = true;
  render({ ...props, visible: false });
  assert.equal(terminal.options.fontWeight, 700);
  assert.equal(fits, beforeHidden);
  render(props);
  assert.ok(fits > beforeHidden);
  assert.equal(spawns, 1);
  assert.equal(terminals.length, 1);
  assert.equal(disposed, 0);
});

test('Monaco options follow bold toggles without refetching the diff', async () => {
  const state = { fontBold: false, fontSize: 14, theme: 'dark' };
  let requests = 0;
  const render = await componentHarness('DiffWindow', state, {
    git: {
      diff: async () => {
        requests++;
        return { oldContent: 'old', newContent: 'new' };
      },
    },
  });
  const props = { repoPath: 'C:\\repo', filePath: 'file.ts', staged: false, onClose() {} };
  render(props);
  await Promise.resolve();
  for (const bold of [false, true, false]) {
    state.fontBold = bold;
    const editor = find(render(props), (node) => node.type === 'MockDiffEditor');
    assert.equal(editor.props.options.fontWeight, bold ? '700' : '400');
    assert.equal(editor.props.options.fontSize, 14);
  }
  assert.equal(requests, 1);
});

test('font picker exposes a controlled bold toggle, disables writes and surfaces errors', async () => {
  let reject;
  let requested;
  const state = {
    fontSize: 14,
    fontBold: false,
    setFontSize: async () => {},
    setFontBold: (value) => {
      requested = value;
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    },
  };
  const render = await componentHarness('FontSizePicker', state);
  find(render(), (node) => node.type === 'button').props.onClick();
  const checkbox = () => find(render(), (node) => node.type === 'input');
  assert.equal(checkbox().props.checked, false);
  checkbox().props.onChange({ target: { checked: true } });
  assert.equal(requested, true);
  assert.equal(checkbox().props.disabled, true);
  reject(new Error('Cannot save font setting'));
  await Promise.resolve();
  assert.equal(checkbox().props.disabled, false);
  assert.equal(checkbox().props.checked, false);
  assert.equal(
    find(render(), (node) => node.props?.role === 'alert').props.children,
    'Cannot save font setting',
  );
  state.fontBold = true;
  assert.equal(checkbox().props.checked, true);
});

test('interface weights use the preference variable without overriding xterm ANSI classes', async () => {
  const css = await source('renderer/styles/theme.css');
  assert.match(css, /--app-font-weight:\s*400/);
  const declarations = [...css.matchAll(/(?<!-)font-weight:\s*([^;]+);/g)].map((match) => match[1]);
  assert.ok(declarations.length > 10);
  assert.ok(declarations.every((value) => value === 'var(--app-font-weight)'));
  assert.doesNotMatch(css, /\.xterm[^{]*\{[^}]*font-weight:/);
});
