import { useEffect, useState } from 'react';
import { ClaudeIcon } from './ClaudeIcon';
import type { UpdateStatus } from '../../shared/types';

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
        if (active) setUpdateError(String(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function runUpdateAction(action: 'check' | 'install') {
    setPending(true);
    setUpdateError(null);
    try {
      setUpdate(await window.api.updates[action]());
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <ClaudeIcon size={20} />
          <span>About Parallel Agents</span>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="about-tagline">
            One window for all your CLI coding agents — Claude Code, Codex, Gemini CLI, and more.
          </p>
          <dl className="about-meta">
            <dt>Version</dt>
            <dd>{__APP_BUILD_INFO__.version}</dd>
            <dt>Commit</dt>
            <dd title={__APP_BUILD_INFO__.commit ?? undefined}>
              <code>
                {__APP_BUILD_INFO__.commit?.slice(0, 12) ?? 'Unavailable (source archive)'}
              </code>
              {__APP_BUILD_INFO__.dirty && <span> (uncommitted changes)</span>}
            </dd>
            <dt>Author</dt>
            <dd>jelllove</dd>
            <dt>Email</dt>
            <dd>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  window.api.shell?.openExternal('mailto:jelllove@gmail.com');
                }}
              >
                jelllove@gmail.com
              </a>
            </dd>
            <dt>Built with</dt>
            <dd>Electron · React · xterm.js · node-pty</dd>
          </dl>
          <section aria-label="Application updates">
            <p role="status" aria-live="polite">
              {!update && !updateError && 'Loading update status…'}
              {update?.state === 'unavailable' && update.message}
              {update?.state === 'idle' &&
                (update.message ?? 'Updates are checked automatically every 4 hours.')}
              {update?.state === 'checking' && 'Checking GitHub releases…'}
              {update?.state === 'available' && `Downloading version ${update.version}…`}
              {update?.state === 'downloading' &&
                `Downloading version ${update.version}: ${Math.round(update.percent ?? 0)}%`}
              {update?.state === 'downloaded' && `Version ${update.version} is ready to install.`}
              {update?.state === 'installing' && 'Installing update and restarting…'}
            </p>
            {update?.state === 'downloading' && (
              <progress
                aria-label="Update download progress"
                max={100}
                value={update.percent ?? 0}
              />
            )}
            {(updateError || update?.state === 'error') && (
              <p role="alert" style={{ overflowWrap: 'anywhere' }}>
                {updateError ?? update?.message}
              </p>
            )}
            <button
              className="btn-secondary"
              disabled={
                !update ||
                pending ||
                update.state === 'unavailable' ||
                update.canInstall ||
                ['checking', 'available', 'downloading', 'installing'].includes(update.state)
              }
              onClick={() => void runUpdateAction('check')}
            >
              Check for updates
            </button>
            {update?.canInstall && (
              <button
                className="btn-primary"
                disabled={pending || update.state === 'installing'}
                onClick={() => void runUpdateAction('install')}
              >
                Restart to update
              </button>
            )}
            {update && update.state !== 'unavailable' && (
              <p>
                Updates download in the background. Agents are stopped only when you confirm a
                restart; quitting normally does not install updates.
              </p>
            )}
          </section>
          <p className="about-footer">
            Run multiple agent sessions side by side, without losing context.
          </p>
        </div>
      </div>
    </div>
  );
}
