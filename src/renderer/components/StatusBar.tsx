import { useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { LayoutPicker } from './LayoutPicker';
import { SettingsPicker } from './SettingsPicker';
import { FontSizePicker } from './FontSizePicker';

export function StatusBar() {
  const project = useAppStore((s) => {
    const focusedId = s.activeTabId
      ? (s.tabProjectId[s.activeTabId] ?? s.activeTabId)
      : s.selectedProjectId;
    if (!focusedId) return undefined;
    return (
      s.projects.find((p) => p.id === focusedId) ?? s.adhocProjects.find((p) => p.id === focusedId)
    );
  });
  const openTabs = useAppStore((s) => s.openTabs);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const layoutBtnRef = useRef<HTMLButtonElement | null>(null);
  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const [settingsRect, setSettingsRect] = useState<DOMRect | null>(null);

  return (
    <div className="status-bar">
      <span className="item">Mode: Ready</span>
      <span className="item">Tabs: {openTabs.length}</span>
      <span className="spacer" />
      {project && (
        <span className="item status-project-path" title={project.realPath}>
          {project.realPath}
        </span>
      )}
      <FontSizePicker />
      <button
        className="sb-btn"
        title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>
      <button
        ref={settingsBtnRef}
        className="sb-btn"
        title="Settings"
        onClick={() => {
          if (settingsRect) {
            setSettingsRect(null);
            return;
          }
          const r = settingsBtnRef.current?.getBoundingClientRect();
          if (r) setSettingsRect(r);
        }}
      >
        ⚙
      </button>
      <button
        ref={layoutBtnRef}
        className="sb-btn"
        title="Window layout"
        onClick={() => {
          if (pickerRect) {
            setPickerRect(null);
            return;
          }
          const r = layoutBtnRef.current?.getBoundingClientRect();
          if (r) setPickerRect(r);
        }}
      >
        ⊞
      </button>
      {pickerRect && <LayoutPicker anchorRect={pickerRect} onClose={() => setPickerRect(null)} />}
      {settingsRect && (
        <SettingsPicker anchorRect={settingsRect} onClose={() => setSettingsRect(null)} />
      )}
    </div>
  );
}
