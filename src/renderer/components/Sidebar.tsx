import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '../store/app-store';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';
import { AgentPicker } from './AgentPicker';
import { NewProjectDialog } from './NewProjectDialog';
import type { AgentId } from '../../shared/types';

interface Props {
  onAbout: () => void;
}

export function Sidebar({ onAbout }: Props) {
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const sessionGuideProjectId = useAppStore((s) => s.sessionGuideProjectId);
  const sessionGuideSeq = useAppStore((s) => s.sessionGuideSeq);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [sessionsFlashing, setSessionsFlashing] = useState(false);
  const [newProjectAgent, setNewProjectAgent] = useState<AgentId | null>(null);

  function handleNew(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicker({ x: rect.right + 4, y: rect.top });
  }

  function onPick(id: AgentId) {
    setPicker(null);
    setNewProjectAgent(id);
  }

  useEffect(() => {
    if (!sessionGuideProjectId || sessionGuideProjectId !== selectedProjectId) return;
    setSessionsFlashing(false);
    const raf = window.requestAnimationFrame(() => setSessionsFlashing(true));
    const timer = window.setTimeout(() => setSessionsFlashing(false), 1050);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [selectedProjectId, sessionGuideProjectId, sessionGuideSeq]);

  return (
    <div className="sidebar">
      <button className="btn-primary" onClick={handleNew}>
        <span className="btn-plus">+</span>
        <span>New Project</span>
      </button>
      <div className="sidebar-split">
        <PanelGroup direction="vertical" autoSaveId="parallel-agents-sidebar-layout">
          <Panel defaultSize={60} minSize={20}>
            <div className="sidebar-section scrollable">
              <div className="sidebar-title section-projects">
                <span className="section-glyph">▣</span>
                <span>Projects</span>
              </div>
              <ProjectList />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle-h" />
          <Panel defaultSize={40} minSize={15}>
            <div
              className={`sidebar-section scrollable sessions${sessionsFlashing ? ' sessions-guide-flash' : ''}`}
            >
              <div className="sidebar-title section-sessions">
                <span className="section-glyph">⏱</span>
                <span>Recent Sessions</span>
              </div>
              <SessionList />
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <button className="sidebar-about" onClick={onAbout} title="About">
        <span className="section-glyph about-glyph">i</span>
        <span>About</span>
      </button>
      {picker && agents.length > 0 && (
        <AgentPicker
          agents={agents}
          status={status}
          onPick={onPick}
          onClose={() => setPicker(null)}
          anchorX={picker.x}
          anchorY={picker.y}
          title="Pick an agent CLI"
        />
      )}
      {newProjectAgent && (
        <NewProjectDialog agent={newProjectAgent} onClose={() => setNewProjectAgent(null)} />
      )}
    </div>
  );
}
