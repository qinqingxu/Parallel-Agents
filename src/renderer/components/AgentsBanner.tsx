import { useAppStore } from '../store/app-store';
import { AgentIcon } from './AgentIcon';
import { useEffect, useState } from 'react';

export function AgentsBanner() {
  const agents = useAppStore((s) => s.agents);
  const status = useAppStore((s) => s.agentStatus);
  const recheck = useAppStore((s) => s.checkAgents);
  const [intro, setIntro] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!agents.length) return null;
  const expanded = intro || hovered || focused;

  return (
    <div
      className={`agents-banner-region${expanded ? ' expanded' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={(event) => {
        setHovered(false);
        setIntro(false);
        if (!event.currentTarget.querySelector(':focus-visible')) setFocused(false);
      }}
      onFocus={(event) => setFocused(event.target.matches(':focus-visible'))}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <button
        className="agents-banner-handle"
        aria-label="Show CLI tools"
        aria-expanded={expanded}
        onClick={() => setHovered(!hovered)}
      />
      <div className="agents-banner" hidden={!expanded}>
        <span className="ab-label">CLIs:</span>
        {agents.map((a) => {
          const st = status[a.id];
          const ok = st?.available;
          return (
            <button
              key={a.id}
              className={`ab-chip${ok ? ' ok' : ' missing'}`}
              onClick={() => {
                if (!ok && window.api.shell?.openExternal) {
                  void window.api.shell
                    .openExternal(a.installUrl)
                    .catch((err) => setError(String(err)));
                }
              }}
              title={ok ? (st.path ?? a.displayName) : `Install: ${a.installHint}`}
            >
              <AgentIcon agent={a.id} className="ab-icon" size={14} />
              <span className="ab-name">{a.displayName}</span>
              <span className="ab-status">{ok ? '✓' : '⚠'}</span>
            </button>
          );
        })}
        <button
          className="ab-recheck"
          onClick={() => {
            setError('');
            void recheck().catch((err) => setError(String(err)));
          }}
        >
          Re-check
        </button>
        {error && (
          <span className="inventory-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
