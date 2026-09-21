import { useEffect, useRef, useState } from 'react';
import { useAppStore, type SessionLinkRequest } from '../store/app-store';
import type { Session } from '../../shared/types';

export function SessionLinkDialog({
  request,
  onLinked,
}: {
  request: SessionLinkRequest;
  onLinked: (projectId: string, session: Session) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(request.sessionId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sessions = useAppStore((s) => s.sessions);
  const projectId = useAppStore((s) => s.tabProjectId[request.tabId]);
  const agent = useAppStore((s) => s.tabAgent[request.tabId]);
  const list = (sessions[projectId] ?? []).filter((session) => session.agent === agent);
  const selectedSession = list.find((session) => session.id === selected);
  const close = () => useAppStore.getState().requestSessionLink(null);

  useEffect(() => {
    dialog.current?.showModal();
    void useAppStore
      .getState()
      .loadSessions(projectId)
      .catch((err) => setError(String(err)));
  }, [projectId]);

  return (
    <dialog
      ref={dialog}
      className="workflow-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedSession) return;
          try {
            useAppStore.getState().linkSession(request.tabId, selectedSession.id);
            onLinked(projectId, selectedSession);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        <h2>Link a session to this tab</h2>
        <p>
          Choose the session running in this terminal. Linking does not start or stop a CLI. Confirm
          its identity before linking: another CLI may have created history in this project.
        </p>
        <label className="workflow-field">
          Running session
          <select
            autoFocus
            required
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choose a session...</option>
            {list.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} ({session.id})
              </option>
            ))}
          </select>
        </label>
        {!list.length && <p>No history yet. Send a message in the agent, then try again.</p>}
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={close}>
            Cancel
          </button>
          {request.sessionId && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !selectedSession}
              title="Only resume separately if this session is not running in another terminal"
              onClick={async () => {
                if (!selectedSession) return;
                setBusy(true);
                try {
                  await useAppStore.getState().openSessionTab(projectId, selectedSession, true);
                  close();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resume separately
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !selectedSession}>
            {request.renameAfterLink ? 'Link & rename' : 'Link to running tab'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
