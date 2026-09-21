import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function CloseTabConfirmDialog({
  title,
  message,
  confirmText = 'Close tab',
  onConfirm,
  onCancel,
}: Props) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm(dontAskAgain);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, dontAskAgain]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">
          <div>{message}</div>
          <label className="modal-check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
            />
            <span>Don't ask again</span>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            className="btn-primary"
            onClick={() => onConfirm(dontAskAgain)}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
