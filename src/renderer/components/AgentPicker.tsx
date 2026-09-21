import { useEffect, useState } from 'react';
import type { AgentId, AgentInfo, AgentStatus } from '../../shared/types';
import { AgentIcon } from './AgentIcon';

interface Props {
  agents: AgentInfo[];
  status: Record<AgentId, AgentStatus>;
  onPick: (agentId: AgentId) => void;
  onClose: () => void;
  anchorX: number;
  anchorY: number;
  title?: string;
}

export function AgentPicker({ agents, status, onPick, onClose, anchorX, anchorY, title }: Props) {
  const [pos, setPos] = useState({ x: anchorX, y: anchorY });

  useEffect(() => {
    const W = 240;
    const H = 60 + agents.length * 44;
    const maxX = window.innerWidth - W - 8;
    const maxY = window.innerHeight - H - 8;
    setPos({ x: Math.min(anchorX, maxX), y: Math.min(anchorY, maxY) });
  }, [anchorX, anchorY, agents.length]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div className="agent-picker-backdrop" onClick={onClose} />
      <div
        className="agent-picker"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="agent-picker-title">{title}</div>}
        {agents.map((a) => {
          const st = status[a.id];
          const available = st?.available ?? false;
          return (
            <div
              key={a.id}
              className={`agent-picker-row${available ? '' : ' unavailable'}`}
              onClick={() => {
                if (available) onPick(a.id);
              }}
              title={
                available ? a.displayName : `${a.displayName} not installed — ${a.installHint}`
              }
            >
              <AgentIcon agent={a.id} className="agent-picker-icon" size={22} />
              <div className="agent-picker-text">
                <div className="agent-picker-name">{a.displayName}</div>
                <div className="agent-picker-sub">
                  {available ? st?.path || 'installed' : 'not installed'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
