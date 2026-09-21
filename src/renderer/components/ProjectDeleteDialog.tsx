import { useEffect, useRef, useState } from 'react';
import type { Project, Session } from '../../shared/types';
import { deleteMessageFor } from '../../shared/project-delete';
import './ProjectDeleteDialog.css';

export function ProjectDeleteDialog({
  projects,
  onConfirm,
  onCancel,
}: {
  projects: Project[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot] = useState(projects);
  const [sessions, setSessions] = useState<Record<string, Session[]> | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    Promise.all(
      snapshot.map(
        async (project) =>
          [project.id, await window.api.sessions.listForProject(project.id)] as const,
      ),
    )
      .then((entries) => {
        if (!cancelled) setSessions(Object.fromEntries(entries));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  const ready = sessions !== null && snapshot.length > 0;
  return (
    <dialog
      ref={dialog}
      className="workflow-dialog project-delete-dialog"
      aria-labelledby="delete-project-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready || !armed || busy) return;
          setBusy(true);
          setError('');
          try {
            await onConfirm();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setArmed(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="delete-project-title">
          Delete{' '}
          {snapshot.length === 1 ? 'project history' : `${snapshot.length} project histories`}?
        </h2>
        <p>Review the highlighted projects and their sessions. Working folders are not deleted.</p>
        <div className="project-delete-summary">
          {snapshot.map((project) => (
            <section key={project.id}>
              <div className="project-delete-name">{project.displayName}</div>
              <div className="project-delete-path">{project.realPath}</div>
              <p>{deleteMessageFor(project)}</p>
              <details open>
                <summary>
                  {sessions
                    ? `${sessions[project.id].length} session${sessions[project.id].length === 1 ? '' : 's'}`
                    : 'Loading sessions...'}
                </summary>
                <ul>
                  {sessions?.[project.id].map((session) => (
                    <li key={session.id}>
                      <span>{session.title || '(Untitled session)'}</span> <code>{session.id}</code>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ))}
        </div>
        <label className="modal-check">
          <input
            type="checkbox"
            autoFocus
            checked={armed}
            disabled={!ready || busy}
            onChange={(event) => setArmed(event.target.checked)}
          />
          <span>
            I have reviewed these projects and sessions and understand deletion cannot be undone.
          </span>
        </label>
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-danger" disabled={!ready || !armed || busy}>
            {busy ? 'Deleting...' : 'Delete forever'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
