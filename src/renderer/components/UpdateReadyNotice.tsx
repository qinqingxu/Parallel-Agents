import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';

export function UpdateReadyNotice() {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const unsubscribe = window.api.updates.onStatus((status) => {
      receivedEvent = true;
      if (active) setUpdate(status);
    });
    window.api.updates
      .getStatus()
      .then((status) => {
        if (active && !receivedEvent) setUpdate(status);
      })
      .catch((error) => {
        console.error('Failed to load update notification status:', error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function restart() {
    setPending(true);
    setError(null);
    try {
      setUpdate(await window.api.updates.install());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  if (!update?.canInstall || !update.version || dismissedVersion === update.version) return null;
  const installing = update.state === 'installing';

  return (
    <aside
      aria-label="Update ready"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 40,
        zIndex: 900,
        width: 380,
        maxWidth: 'calc(100vw - 32px)',
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg-elev)',
        color: 'var(--text)',
        boxShadow: '0 4px 16px #0004',
      }}
    >
      <p role="status" aria-live="polite" style={{ marginTop: 0 }}>
        {installing
          ? 'Installing update and restarting…'
          : `Version ${update.version} is ready to install.`}
      </p>
      <p>Your agents will keep running until you confirm a restart.</p>
      {(error || update.state === 'error') && (
        <p role="alert" style={{ overflowWrap: 'anywhere' }}>
          {error ?? update.message}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-primary"
          disabled={pending || installing}
          onClick={() => void restart()}
        >
          Restart to update
        </button>
        <button
          className="btn-secondary"
          disabled={pending || installing}
          onClick={() => setDismissedVersion(update.version!)}
        >
          Later
        </button>
      </div>
      <p style={{ marginBottom: 0, color: 'var(--text-dim)' }}>
        You can also install this update later from About.
      </p>
    </aside>
  );
}
