import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  message: string;
  confirmText: string;
  typeToConfirm: string;
  destructive?: boolean;
  warning?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmText,
  typeToConfirm,
  destructive,
  warning,
  confirmDisabled,
  onConfirm,
  onCancel,
}: Props) {
  const [input, setInput] = useState('');
  const [armed, setArmed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canConfirm = input === typeToConfirm && armed && !confirmDisabled;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">
          <div>{message}</div>
          <div
            style={{
              marginTop: 12,
              fontSize: 'calc(var(--app-font-size) * 0.923077)',
              color: 'var(--text-dim)',
            }}
          >
            Type <code>{typeToConfirm}</code> to enable the {confirmText} button:
          </div>
          <input
            ref={inputRef}
            className="modal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={typeToConfirm}
          />
          <label className="modal-check">
            <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
            <span>I understand this cannot be undone.</span>
          </label>
          {warning && (
            <div className="modal-warn" role="alert">
              {warning}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={destructive ? 'btn-danger' : 'btn-primary'}
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm) void onConfirm();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
