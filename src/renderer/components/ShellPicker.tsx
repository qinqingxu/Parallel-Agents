import { useEffect, useState } from 'react';
import type { AvailableShell } from '../../shared/types';

interface Props {
  x: number;
  y: number;
  onPick: (shell: AvailableShell) => void;
  onClose: () => void;
}

export function ShellPicker({ x, y, onPick, onClose }: Props) {
  const [shells, setShells] = useState<AvailableShell[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    window.api.shell
      .list()
      .then((list) => {
        if (!cancelled) setShells(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="layout-picker-backdrop" onClick={onClose} />
      <div
        className="ctx-menu shell-picker"
        role="menu"
        aria-label="Choose shell"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 300)),
          top: Math.max(8, Math.min(y, window.innerHeight - 300)),
        }}
      >
        <div className="layout-picker-title">Choose an installed shell</div>
        {error ? (
          <div className="inventory-error" role="alert">
            {error}
          </div>
        ) : shells === null ? (
          <div className="ctx-menu-item">Detecting shells...</div>
        ) : shells.length === 0 ? (
          <div className="ctx-menu-item">No supported shells found.</div>
        ) : (
          shells.map((shell) => (
            <button
              key={shell.id}
              className="ctx-menu-item"
              role="menuitem"
              title={[shell.command, ...shell.args].join(' ')}
              onClick={() => onPick(shell)}
            >
              {shell.label}
            </button>
          ))
        )}
        <div className="list-item-sub">Switching shells stops the previous shell.</div>
      </div>
    </>
  );
}
