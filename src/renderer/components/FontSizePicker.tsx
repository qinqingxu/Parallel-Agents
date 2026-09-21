import { useState } from 'react';
import { useAppStore } from '../store/app-store';
import {
  DEFAULT_FONT_SIZE,
  FONT_FAMILY_OPTIONS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from '../../shared/typography';

export function FontSizePicker() {
  const size = useAppStore((s) => s.fontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const fontFamily = useAppStore((s) => s.fontFamily);
  const setFontFamily = useAppStore((s) => s.setFontFamily);
  const bold = useAppStore((s) => s.fontBold);
  const setFontBold = useAppStore((s) => s.setFontBold);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(next: number) {
    setBusy(true);
    setError('');
    try {
      await setFontSize(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function changeBold(next: boolean) {
    setBusy(true);
    setError('');
    try {
      await setFontBold(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function changeFontFamily(next: string) {
    setBusy(true);
    setError('');
    try {
      await setFontFamily(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="font-size-control">
      <button
        className="sb-btn"
        title="Adjust font size and weight"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Aa {size}
      </button>
      {open && (
        <>
          <div className="layout-picker-backdrop" onClick={() => setOpen(false)} />
          <div
            className="font-size-picker"
            role="dialog"
            aria-label="Font settings"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            <strong>Font size</strong>
            <p>Interface size plus terminal and diff typography</p>
            <label className="font-family-field">
              <span>Font family</span>
              <select
                value={fontFamily}
                disabled={busy}
                onChange={(e) => void changeFontFamily(e.target.value)}
              >
                {FONT_FAMILY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="font-size-buttons">
              <button
                className="btn-secondary"
                aria-label="Decrease font size"
                disabled={busy || size <= MIN_FONT_SIZE}
                onClick={() => void change(size - 1)}
              >
                A−
              </button>
              <output>{size}px</output>
              <button
                className="btn-secondary"
                aria-label="Increase font size"
                disabled={busy || size >= MAX_FONT_SIZE}
                onClick={() => void change(size + 1)}
              >
                A+
              </button>
            </div>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void change(DEFAULT_FONT_SIZE)}
            >
              Reset to VS Code-style default
            </button>
            <label className="font-bold-toggle">
              <input
                type="checkbox"
                checked={bold}
                disabled={busy}
                onChange={(e) => void changeBold(e.target.checked)}
              />
              Bold text
            </label>
            {error && (
              <p className="inventory-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
