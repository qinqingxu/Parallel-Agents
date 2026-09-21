import { Suspense, lazy, useEffect, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { GitDiff } from '../../shared/types';
import { resolveFontFamily } from '../../shared/typography';

const DiffEditor = lazy(async () => {
  const [mod, { monaco }] = await Promise.all([
    import('@monaco-editor/react'),
    import('../monaco'),
  ]);
  mod.loader.config({ monaco });
  return { default: mod.DiffEditor };
});

interface Props {
  repoPath: string;
  filePath: string;
  staged: boolean;
  onClose: () => void;
}

function languageFor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    sh: 'shell',
    ps1: 'powershell',
    sql: 'sql',
    xml: 'xml',
  };
  return map[ext] ?? 'plaintext';
}

export function DiffWindow({ repoPath, filePath, staged, onClose }: Props) {
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const themeMode = useAppStore((s) => s.theme);
  const fontSize = useAppStore((s) => s.fontSize);
  const fontFamily = useAppStore((s) => s.fontFamily);
  const fontBold = useAppStore((s) => s.fontBold);

  useEffect(() => {
    let cancelled = false;
    window.api.git
      .diff(repoPath, filePath, staged)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, filePath, staged]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lang = languageFor(filePath);

  return (
    <div className="diff-backdrop" onClick={onClose}>
      <div className="diff-window" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <span className="diff-title">{filePath}</span>
          <span className="diff-sub">
            {staged ? 'staged' : 'working tree'}
            {diff && ` · ${diff.oldLabel} → ${diff.newLabel}`}
          </span>
          <button className="diff-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="diff-body">
          {error ? (
            <div style={{ padding: 20, color: '#d16969' }}>Error: {error}</div>
          ) : !diff ? (
            <div style={{ padding: 20, color: 'var(--text-dim)' }}>Loading diff…</div>
          ) : (
            <Suspense
              fallback={
                <div style={{ padding: 20, color: 'var(--text-dim)' }}>Loading editor…</div>
              }
            >
              <DiffEditor
                height="100%"
                language={lang}
                original={diff.oldContent}
                modified={diff.newContent}
                theme={themeMode === 'light' ? 'vs' : 'vs-dark'}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  fontSize,
                  fontWeight: fontBold ? '700' : '400',
                  fontFamily: resolveFontFamily(fontFamily),
                  scrollBeyondLastLine: false,
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
