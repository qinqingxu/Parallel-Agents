import type { AgentId } from '../../shared/types';
import { agentIconUrl } from '../icons/agentIcons';

export function AgentIcon({
  agent,
  className,
  size = 16,
}: {
  agent: AgentId;
  className?: string;
  size?: number;
}) {
  const url = agentIconUrl(agent);
  if (agent !== 'codex')
    return (
      <img src={url} className={className} width={size} height={size} alt="" draggable={false} />
    );
  return (
    <span
      className={`${className ?? ''} codex-icon`}
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: 'currentColor',
        maskImage: `url("${url}")`,
        WebkitMaskImage: `url("${url}")`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  );
}
