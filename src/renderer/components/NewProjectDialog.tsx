import { useEffect, useRef, useState } from 'react';
import type { AgentId } from '../../shared/types';
import { useAppStore } from '../store/app-store';

export function NewProjectDialog({ agent, onClose }: { agent: AgentId; onClose: () => void }) {
  const createProject = useAppStore((s) => s.createProject);
  const agentName = useAppStore((s) => s.agents.find((a) => a.id === agent)?.displayName ?? agent);
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'folder' | 'worktree'>('folder');
  const [basePath, setBasePath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [branch, setBranch] = useState('');
  const [startPoint, setStartPoint] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function browse() {
    try {
      const folder = await window.api.dialog.pickDirectory();
      if (folder) setBasePath(folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="workflow-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await createProject({ agent, mode, basePath, targetPath, branch, startPoint });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>New Project · {agentName}</h2>
        <label className="workflow-field">
          Workspace mode
          <select
            autoFocus
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value === 'worktree' ? 'worktree' : 'folder')}
          >
            <option value="folder">Open a folder directly</option>
            <option value="worktree">Create a Git worktree from a base folder</option>
          </select>
        </label>
        <label className="workflow-field">
          {mode === 'worktree' ? 'Base repository folder' : 'Project folder'}
          <div className="workflow-path">
            <input
              value={basePath}
              disabled={busy}
              required
              onChange={(e) => setBasePath(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void browse()}
            >
              Browse...
            </button>
          </div>
        </label>
        {mode === 'worktree' && (
          <>
            <label className="workflow-field">
              New branch
              <input
                value={branch}
                disabled={busy}
                required
                placeholder="feature/my-task"
                onChange={(e) => {
                  const name = e.target.value;
                  setBranch(name);
                  const separator = basePath.includes('\\') ? '\\' : '/';
                  if (
                    !targetPath ||
                    targetPath ===
                      `${basePath}.worktrees${separator}${branch.replace(/[\\/]/g, '-')}`
                  ) {
                    setTargetPath(
                      `${basePath}.worktrees${separator}${name.replace(/[\\/]/g, '-')}`,
                    );
                  }
                }}
              />
            </label>
            <label className="workflow-field">
              Start from branch, tag or commit
              <input
                value={startPoint}
                disabled={busy}
                required
                onChange={(e) => setStartPoint(e.target.value)}
              />
            </label>
            <label className="workflow-field">
              New worktree directory (absolute path)
              <input
                value={targetPath}
                disabled={busy}
                required
                onChange={(e) => setTargetPath(e.target.value)}
              />
            </label>
            <p>
              Git creates a new branch and linked worktree. Existing folders are never overwritten;
              uncommitted changes stay in the base folder.
            </p>
          </>
        )}
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy
              ? 'Preparing workspace...'
              : mode === 'worktree'
                ? 'Create worktree & launch'
                : 'Open folder & launch'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
