import { nextSessionTab } from './store/tab-state.ts';

export function handleSessionTabShortcut(
  event: KeyboardEvent,
  openTabs: string[],
  activeTabId: string | null,
  activate: (id: string) => void,
  modalOpen: boolean,
): void {
  if (event.key !== 'Tab' || !event.ctrlKey || event.altKey || event.metaKey || modalOpen) return;
  const next = nextSessionTab(openTabs, activeTabId, event.shiftKey);
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  activate(next);
}
