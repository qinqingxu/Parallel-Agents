import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { validateSessionName } from '../../shared/session-presentation';

interface Props {
  projectId: string;
  sessionId: string;
  title: string;
  onClose: () => void;
}

export function RenameSessionDialog({ projectId, sessionId, title, onClose }: Props) {
  const renameSession = useAppStore((s) => s.renameSession);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

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
          setError('');
          setBusy(true);
          try {
            await renameSession(projectId, sessionId, validateSessionName(name));
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Rename session</h2>
        <p>The name is saved in Parallel Agents and shared with the session tab.</p>
        <label className="workflow-field">
          Session name
          <input
            autoFocus
            value={name}
            maxLength={120}
            disabled={busy}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving...' : 'Save name'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
