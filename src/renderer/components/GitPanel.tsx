import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { DiffWindow } from './DiffWindow';
import type { GitChange, GitFileState } from '../../shared/types';

function letterFor(state: GitFileState | null): string {
  if (!state) return ' ';
  switch (state) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'untracked':
      return 'U';
    case 'conflict':
      return '!';
  }
}

function colorFor(state: GitFileState | null): string {
  if (!state) return 'var(--text-dim)';
  switch (state) {
    case 'modified':
      return '#e2c08d';
    case 'added':
      return '#73c991';
    case 'deleted':
      return '#f48771';
    case 'renamed':
      return '#7cc4ff';
    case 'untracked':
      return '#73c991';
    case 'conflict':
      return '#d16969';
  }
}

export function GitPanel() {
  const project = useAppStore((s) => {
    const focusedId = s.activeTabId
      ? (s.tabProjectId[s.activeTabId] ?? s.activeTabId)
      : s.selectedProjectId;
    if (!focusedId) return undefined;
    return (
      s.projects.find((p) => p.id === focusedId) ?? s.adhocProjects.find((p) => p.id === focusedId)
    );
  });
  const gitStatusByPath = useAppStore((s) => s.gitStatusByPath);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);

  const repoPath = project?.exists ? project.realPath : null;
  const status = repoPath ? gitStatusByPath[repoPath] : null;

  const [commitMsg, setCommitMsg] = useState('');
  const [diffOpen, setDiffOpen] = useState<{ file: string; staged: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (repoPath && status === undefined) void loadGitStatus(repoPath);
  }, [repoPath, status, loadGitStatus]);

  const { staged, unstaged, untracked } = useMemo(() => {
    const out = {
      staged: [] as GitChange[],
      unstaged: [] as GitChange[],
      untracked: [] as GitChange[],
    };
    if (!status) return out;
    for (const c of status.changes) {
      if (c.staged) out.staged.push(c);
      if (c.unstaged === 'untracked') out.untracked.push(c);
      else if (c.unstaged) out.unstaged.push(c);
    }
    return out;
  }, [status]);

  if (!project) {
    return (
      <div className="git-panel">
        <div className="git-header section-git">
          <span className="section-glyph">⎇</span>
          <span>Git</span>
        </div>
        <div className="list-item-sub" style={{ padding: '8px 12px' }}>
          No project selected.
        </div>
      </div>
    );
  }
  if (!repoPath) {
    return (
      <div className="git-panel">
        <div className="git-header section-git">
          <span className="section-glyph">⎇</span>
          <span>Git</span>
        </div>
        <div className="list-item-sub" style={{ padding: '8px 12px' }}>
          Directory not found.
        </div>
      </div>
    );
  }
  if (status === undefined) {
    return (
      <div className="git-panel">
        <div className="git-header section-git">
          <span className="section-glyph">⎇</span>
          <span>Git</span>
        </div>
        <div className="list-item-sub" style={{ padding: '8px 12px' }}>
          Loading…
        </div>
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="git-panel">
        <div className="git-header section-git">
          <span className="section-glyph">⎇</span>
          <span>Git</span>
        </div>
        <div className="list-item-sub" style={{ padding: '8px 12px' }}>
          (not a git repository)
        </div>
      </div>
    );
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
    if (repoPath) await loadGitStatus(repoPath);
  }

  function renderGroup(title: string, items: GitChange[], stagedGroup: boolean) {
    if (items.length === 0) return null;
    return (
      <div className="git-group">
        <div className="git-group-title">
          <span>{title}</span>
          <span className="git-group-count">{items.length}</span>
          {stagedGroup && items.length > 0 && (
            <button
              className="git-group-action"
              title="Unstage all"
              onClick={() =>
                withBusy(async () => {
                  await window.api.git.unstage(
                    repoPath!,
                    items.map((c) => c.path),
                  );
                })
              }
            >
              −
            </button>
          )}
          {!stagedGroup && items.length > 0 && (
            <button
              className="git-group-action"
              title="Stage all"
              onClick={() =>
                withBusy(async () => {
                  await window.api.git.stage(
                    repoPath!,
                    items.map((c) => c.path),
                  );
                })
              }
            >
              +
            </button>
          )}
        </div>
        {items.map((c) => {
          const state = stagedGroup ? c.staged : c.unstaged;
          const isUntracked = c.unstaged === 'untracked' && !c.staged;
          return (
            <div
              key={(stagedGroup ? 'S:' : 'U:') + c.path}
              className="git-row"
              title={c.path}
              onDoubleClick={() => setDiffOpen({ file: c.path, staged: stagedGroup })}
            >
              <span className="git-letter" style={{ color: colorFor(state) }}>
                {letterFor(state)}
              </span>
              <span className="git-path">{c.path}</span>
              <span className="git-row-actions">
                {!stagedGroup && (
                  <button
                    title="Discard changes"
                    disabled={isUntracked}
                    onClick={(e) => {
                      e.stopPropagation();
                      void withBusy(async () => {
                        await window.api.git.discard(repoPath!, [c.path]);
                      });
                    }}
                  >
                    ↺
                  </button>
                )}
                {stagedGroup ? (
                  <button
                    title="Unstage"
                    onClick={(e) => {
                      e.stopPropagation();
                      void withBusy(async () => {
                        await window.api.git.unstage(repoPath!, [c.path]);
                      });
                    }}
                  >
                    −
                  </button>
                ) : (
                  <button
                    title="Stage"
                    onClick={(e) => {
                      e.stopPropagation();
                      void withBusy(async () => {
                        await window.api.git.stage(repoPath!, [c.path]);
                      });
                    }}
                  >
                    +
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-header section-git">
        <span className="section-glyph">⎇</span>
        <span>{status.branch}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="git-ab">
            {status.behind > 0 && <span>↓{status.behind}</span>}
            {status.ahead > 0 && <span>↑{status.ahead}</span>}
          </span>
        )}
        <button
          className="git-refresh"
          title="Refresh"
          disabled={busy}
          onClick={() => repoPath && loadGitStatus(repoPath)}
        >
          ↻
        </button>
      </div>
      <div className="git-body">
        <div className="git-commit">
          <textarea
            placeholder="Commit message"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            rows={2}
          />
          <button
            className="btn-primary"
            disabled={!commitMsg.trim() || staged.length === 0 || busy}
            onClick={() =>
              withBusy(async () => {
                await window.api.git.commit(repoPath!, commitMsg);
                setCommitMsg('');
              })
            }
          >
            Commit ({staged.length})
          </button>
        </div>
        {renderGroup('Staged Changes', staged, true)}
        {renderGroup('Changes', unstaged, false)}
        {renderGroup('Untracked', untracked, false)}
        {staged.length + unstaged.length + untracked.length === 0 && (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>
            Working tree clean.
          </div>
        )}
      </div>
      {diffOpen && (
        <DiffWindow
          repoPath={repoPath!}
          filePath={diffOpen.file}
          staged={diffOpen.staged}
          onClose={() => setDiffOpen(null)}
        />
      )}
    </div>
  );
}
