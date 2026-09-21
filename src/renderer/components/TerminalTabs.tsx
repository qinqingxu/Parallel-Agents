import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/app-store';
import { TerminalPane } from './TerminalPane';
import { CloseTabConfirmDialog } from './CloseTabConfirmDialog';
import { AgentIcon } from './AgentIcon';
import type { AgentId, Project } from '../../shared/types';
import type { SessionShellProfile } from '../../shared/session-terminals';
import {
  agentTerminalKey,
  sessionTabLabelSuffix,
  shellTerminalKey,
} from '../../shared/session-terminals';
import { ShellPicker } from './ShellPicker';
import { RenameSessionDialog } from './RenameSessionDialog';
import { SessionLinkDialog } from './SessionLinkDialog';

interface TabEntry {
  tabId: string;
  project: Project;
  sessionId: string | null;
  label: string;
}

export function TerminalTabs() {
  const openTabs = useAppStore((s) => s.openTabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabProjectId = useAppStore((s) => s.tabProjectId);
  const tabSessionId = useAppStore((s) => s.tabSessionId);
  const findProject = useAppStore((s) => s.findProject);
  const sessionsByProject = useAppStore((s) => s.sessions);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTabs = useAppStore((s) => s.closeTabs);
  const consumePendingCommand = useAppStore((s) => s.consumePendingCommand);
  const tabAgent = useAppStore((s) => s.tabAgent);
  const tabRespawnNonce = useAppStore((s) => s.tabRespawnNonce);
  const tabShellProfile = useAppStore((s) => s.tabShellProfile);
  const tabShellOpened = useAppStore((s) => s.tabShellOpened);
  const tabShellVisible = useAppStore((s) => s.tabShellVisible);
  const openShellForTab = useAppStore((s) => s.openShellForTab);
  const setTabShellVisible = useAppStore((s) => s.setTabShellVisible);
  const confirmOnCloseTab = useAppStore((s) => s.confirmOnCloseTab);
  const setConfirmOnCloseTab = useAppStore((s) => s.setConfirmOnCloseTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  const [pending, setPending] = useState<{
    ids: string[];
    title: string;
    message: string;
    confirmText: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [shellPicker, setShellPicker] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{
    projectId: string;
    sessionId: string;
    title: string;
  } | null>(null);
  const projects = useAppStore((s) => s.projects);
  const sessionLinkRequest = useAppStore((s) => s.sessionLinkRequest);

  const tabEntries = useMemo<TabEntry[]>(() => {
    return openTabs.flatMap<TabEntry>((tabId) => {
      const projectId = tabProjectId[tabId] ?? tabId;
      const project = findProject(projectId);
      if (!project) return [];

      const sessionId = tabSessionId[tabId] ?? null;
      if (!sessionId) {
        return [
          {
            tabId,
            project,
            sessionId: null,
            label: project.displayName,
          },
        ];
      }

      const session = (sessionsByProject[projectId] ?? []).find((item) => item.id === sessionId);
      const suffix = sessionTabLabelSuffix(session?.title ?? '', sessionId);
      return [
        {
          tabId,
          project,
          sessionId,
          label: suffix,
        },
      ];
    });
  }, [openTabs, tabProjectId, findProject, tabSessionId, sessionsByProject, projects]);
  const tabEntryById = useMemo(
    () => new Map(tabEntries.map((entry) => [entry.tabId, entry])),
    [tabEntries],
  );
  function renameTab(tabId: string) {
    const entry = tabEntryById.get(tabId);
    if (entry && !entry.sessionId) {
      useAppStore.getState().requestSessionLink({ tabId, renameAfterLink: true });
      return;
    }
    if (entry?.sessionId)
      setRenaming({
        projectId: entry.project.id,
        sessionId: entry.sessionId,
        title: entry.label,
      });
  }

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [contextMenu]);

  function requestClose(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirmOnCloseTab) {
      closeTabs(ids);
      return;
    }
    if (ids.length === 1) {
      const entry = tabEntryById.get(ids[0]);
      setPending({
        ids,
        title: 'Close this tab?',
        message: `The tab "${entry?.label ?? ids[0]}" will be closed. Any running CLI process in this tab will also stop.`,
        confirmText: 'Close tab',
      });
      return;
    }
    setPending({
      ids,
      title: `Close ${ids.length} tabs?`,
      message: `This will terminate all ${ids.length} running agent sessions.`,
      confirmText: 'Close tabs',
    });
  }

  function handleCloseClick(tabId: string, e: React.MouseEvent) {
    e.stopPropagation();
    requestClose([tabId]);
  }

  function onDragStart(e: React.DragEvent, tabId: string) {
    setDragId(tabId);
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, targetTabId: string) {
    if (!dragId || dragId === targetTabId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetTabId);
  }
  function onDragLeave(targetTabId: string) {
    setDragOverId((cur) => (cur === targetTabId ? null : cur));
  }
  function onDrop(e: React.DragEvent, targetTabId: string) {
    e.preventDefault();
    const src = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!src || src === targetTabId) return;
    reorderTabs(src, targetTabId);
  }

  return (
    <>
      {sessionLinkRequest && (
        <SessionLinkDialog
          request={sessionLinkRequest}
          onLinked={(projectId, session) => {
            if (sessionLinkRequest.renameAfterLink)
              setRenaming({ projectId, sessionId: session.id, title: session.title });
          }}
        />
      )}
      <div className="tab-bar" onClick={() => setContextMenu(null)}>
        {tabEntries.map((entry) => {
          const ag: AgentId = tabAgent[entry.tabId] ?? entry.project.agent;
          return (
            <div
              key={entry.tabId}
              draggable
              onDragStart={(e) => onDragStart(e, entry.tabId)}
              onDragOver={(e) => onDragOver(e, entry.tabId)}
              onDragLeave={() => onDragLeave(entry.tabId)}
              onDrop={(e) => onDrop(e, entry.tabId)}
              className={[
                'tab',
                activeTabId === entry.tabId ? 'active' : '',
                dragOverId === entry.tabId ? 'drag-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setActiveTab(entry.tabId)}
              onDoubleClick={() => renameTab(entry.tabId)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, id: entry.tabId });
              }}
              title={[entry.project.realPath, ag, entry.sessionId ?? null]
                .filter(Boolean)
                .join(' · ')}
            >
              <AgentIcon agent={ag} className="tab-icon" />
              <span>{entry.label}</span>
              <span className="close" onClick={(e) => handleCloseClick(entry.tabId, e)}>
                ×
              </span>
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <div
          className="ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              requestClose([contextMenu.id]);
              setContextMenu(null);
            }}
          >
            Close
          </div>
          <div
            className={`ctx-menu-item${openTabs.length <= 1 ? ' disabled' : ''}`}
            onClick={() => {
              requestClose(openTabs.filter((id) => id !== contextMenu.id));
              setContextMenu(null);
            }}
          >
            Close Others
          </div>
          <div
            className="ctx-menu-item"
            onClick={() => {
              requestClose(openTabs);
              setContextMenu(null);
            }}
          >
            Close All
          </div>
          <div className="ctx-menu-divider" />
          <button
            className="ctx-menu-item"
            onClick={() => {
              renameTab(contextMenu.id);
              setContextMenu(null);
            }}
          >
            Rename session...
          </button>
          <button
            className="ctx-menu-item"
            onClick={() => {
              setShellPicker(contextMenu);
              setContextMenu(null);
            }}
          >
            Open Shell...
          </button>
        </div>
      )}
      {shellPicker && (
        <ShellPicker
          x={shellPicker.x}
          y={shellPicker.y}
          onClose={() => setShellPicker(null)}
          onPick={(shell) => {
            openShellForTab(shellPicker.id, shell.id);
            setShellPicker(null);
          }}
        />
      )}
      {renaming && <RenameSessionDialog {...renaming} onClose={() => setRenaming(null)} />}
      <div className="terminal-host">
        {openTabs.length === 0 ? (
          <div className="empty-state">
            Click <b>+ New Project</b> to pick a folder and launch an agent CLI.
            <br />
            Or select a project on the left to see its history.
          </div>
        ) : (
          <>
            {activeTabId && (
              <div className="terminal-shell-toolbar">
                <button
                  className="terminal-shell-toggle"
                  onClick={(event) => {
                    if (tabShellVisible[activeTabId]) {
                      setTabShellVisible(activeTabId, false);
                    } else {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setShellPicker({ id: activeTabId, x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                >
                  {tabShellVisible[activeTabId] ? 'Hide Shell' : 'Show Shell'}
                </button>
                {tabShellOpened[activeTabId] && (
                  <button
                    className="terminal-shell-meta"
                    title="Change shell"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setShellPicker({ id: activeTabId, x: rect.left, y: rect.bottom + 4 });
                    }}
                  >
                    {tabShellProfile[activeTabId] ?? 'default'}
                  </button>
                )}
              </div>
            )}
            <div className="terminal-panels">
              {tabEntries.map((entry) => {
                const pendingCmd = consumePendingCommand(entry.tabId);
                const nonce = tabRespawnNonce[entry.tabId] ?? 0;
                const profile: SessionShellProfile = tabShellProfile[entry.tabId] ?? 'default';
                const agentKey = agentTerminalKey(entry.tabId);
                const shellKey = shellTerminalKey(entry.tabId, profile);
                const isActive = activeTabId === entry.tabId;
                const isShellVisible = tabShellVisible[entry.tabId] ?? false;
                return (
                  <div
                    key={entry.tabId}
                    className={`terminal-tab-panel ${isActive ? 'active' : ''}`}
                  >
                    <div className="terminal-stack">
                      <div className="terminal-agent-pane">
                        <TerminalPane
                          key={`${agentKey}#${nonce}`}
                          terminalKey={agentKey}
                          cwd={entry.project.realPath}
                          visible={isActive}
                          initialCommand={pendingCmd?.command}
                          extraPath={pendingCmd?.extraPath}
                        />
                      </div>
                      {tabShellOpened[entry.tabId] && (
                        <div className={`terminal-shell-pane ${isShellVisible ? '' : 'hidden'}`}>
                          <TerminalPane
                            key={shellKey}
                            terminalKey={shellKey}
                            cwd={entry.project.realPath}
                            visible={isActive && isShellVisible}
                            shellProfile={profile}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {pending && (
        <CloseTabConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmText={pending.confirmText}
          onConfirm={(dontAsk) => {
            if (dontAsk) void setConfirmOnCloseTab(false);
            closeTabs(pending.ids);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
