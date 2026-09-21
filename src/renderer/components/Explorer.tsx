import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { FsNode } from '../../shared/types';
import { fileIconUrl, folderIconUrl } from '../icons/iconResolver';
import { ConfirmDialog } from './ConfirmDialog';

type Pending =
  { kind: 'newFile' | 'newDir'; parentPath: string } | { kind: 'rename'; node: FsNode } | null;

function joinPath(parent: string, name: string): string {
  // Cross-platform join — keep it simple, use the parent's separator
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  if (parent.endsWith('\\') || parent.endsWith('/')) return parent + name;
  return parent + sep + name;
}

function dirName(p: string): string {
  const m = p.match(/^(.*)[\\/][^\\/]+$/);
  return m ? m[1] : p;
}

export function Explorer() {
  const project = useAppStore((s) => {
    const focusedId = s.activeTabId
      ? (s.tabProjectId[s.activeTabId] ?? s.activeTabId)
      : s.selectedProjectId;
    if (!focusedId) return undefined;
    return (
      s.projects.find((p) => p.id === focusedId) ?? s.adhocProjects.find((p) => p.id === focusedId)
    );
  });
  const clipboard = useAppStore((s) => s.clipboard);
  const setClipboard = useAppStore((s) => s.setClipboard);

  // Children per dir path; null means not loaded.
  const [children, setChildren] = useState<Record<string, FsNode[] | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDir, setSelectedIsDir] = useState<boolean>(false);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingInput, setPendingInput] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: FsNode | null } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<FsNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rootPath = project?.realPath ?? null;

  const reloadDir = useCallback(async (path: string) => {
    const c = await window.api.fs.readDir(path);
    setChildren((cur) => ({ ...cur, [path]: c }));
  }, []);

  useEffect(() => {
    if (!project || !project.exists || !rootPath) return;
    setChildren({});
    setExpanded(new Set());
    setSelectedPath(null);
    void reloadDir(rootPath);
  }, [rootPath, project?.exists, project, reloadDir]);

  const toggleExpand = useCallback(
    async (node: FsNode) => {
      if (!node.isDirectory) return;
      setExpanded((cur) => {
        const next = new Set(cur);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      if (children[node.path] === undefined || children[node.path] === null) {
        await reloadDir(node.path);
      }
    },
    [children, reloadDir],
  );

  function select(node: FsNode) {
    setSelectedPath(node.path);
    setSelectedIsDir(node.isDirectory);
  }

  function refreshParentOf(path: string) {
    const parent = dirName(path);
    if (children[parent] !== undefined) void reloadDir(parent);
  }

  async function doRename(node: FsNode, newName: string) {
    if (!newName || newName === node.name) return;
    const newPath = joinPath(dirName(node.path), newName);
    await window.api.fs.rename(node.path, newPath);
    refreshParentOf(node.path);
  }

  async function doCreate(parentPath: string, name: string, isDir: boolean) {
    if (!name) return;
    const newPath = joinPath(parentPath, name);
    if (isDir) await window.api.fs.createDir(newPath);
    else await window.api.fs.createFile(newPath);
    // ensure parent expanded
    setExpanded((cur) => new Set(cur).add(parentPath));
    await reloadDir(parentPath);
  }

  async function doPaste(targetDir: string) {
    if (!clipboard) return;
    for (const src of clipboard.paths) {
      const name = src.split(/[\\/]/).pop() || 'pasted';
      let dest = joinPath(targetDir, name);
      // simple collision avoidance: append " (n)" before extension
      let n = 2;
      while (true) {
        try {
          if (clipboard.mode === 'copy') await window.api.fs.copy(src, dest);
          else await window.api.fs.move(src, dest);
          break;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes('exists')) throw err;
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          dest = joinPath(targetDir, `${base} (${n})${ext}`);
          n++;
          if (n > 50) throw err;
        }
      }
    }
    if (clipboard.mode === 'cut') setClipboard(null);
    await reloadDir(targetDir);
  }

  function ctxMenuFor(e: React.MouseEvent, node: FsNode | null) {
    e.preventDefault();
    e.stopPropagation();
    if (node) select(node);
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }

  const ctxTargetDir = useMemo(() => {
    if (!ctxMenu) return rootPath ?? '';
    if (!ctxMenu.node) return rootPath ?? '';
    return ctxMenu.node.isDirectory ? ctxMenu.node.path : dirName(ctxMenu.node.path);
  }, [ctxMenu, rootPath]);

  // Keyboard shortcuts (only when explorer has focus)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = containerRef.current;
      if (!el || (!el.contains(document.activeElement) && document.activeElement !== el)) return;
      if (pending) return; // don't intercept while editing
      if (!selectedPath) return;
      const sel: FsNode = {
        name: selectedPath.split(/[\\/]/).pop() || selectedPath,
        path: selectedPath,
        isDirectory: selectedIsDir,
      };
      if (e.key === 'F2') {
        e.preventDefault();
        setPending({ kind: 'rename', node: sel });
        setPendingInput(sel.name);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        setConfirmDelete(sel);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setClipboard({ mode: 'copy', paths: [selectedPath] });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        setClipboard({ mode: 'cut', paths: [selectedPath] });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const target = selectedIsDir ? selectedPath : dirName(selectedPath);
        void doPaste(target);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPath, selectedIsDir, pending, setClipboard]);

  function renderTree(parentPath: string, level: number): React.ReactNode {
    const list = children[parentPath];
    if (list === undefined || list === null) return null;
    return list.map((node) => {
      const isExpanded = expanded.has(node.path);
      const iconUrl = node.isDirectory
        ? folderIconUrl(node.name, isExpanded)
        : fileIconUrl(node.name);
      const isRenaming = pending && pending.kind === 'rename' && pending.node.path === node.path;
      const isCut = clipboard?.mode === 'cut' && clipboard.paths.includes(node.path);
      return (
        <div key={node.path}>
          <div
            className={[
              'tree-node',
              node.isDirectory ? 'dir' : 'file',
              selectedPath === node.path ? 'selected' : '',
              isCut ? 'cut' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 8 + level * 12 }}
            onClick={() => {
              select(node);
              if (node.isDirectory) void toggleExpand(node);
            }}
            onDoubleClick={() => {
              if (node.isDirectory) void window.api.fs.openDefault(node.path);
              else void window.api.fs.openDefault(node.path);
            }}
            onContextMenu={(e) => ctxMenuFor(e, node)}
            title={node.path}
          >
            <span className="twisty">{node.isDirectory ? (isExpanded ? '▾' : '▸') : ''}</span>
            <img className="file-icon" src={iconUrl} alt="" draggable={false} />
            {isRenaming ? (
              <input
                autoFocus
                className="explorer-input"
                value={pendingInput}
                onChange={(e) => setPendingInput(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const name = pendingInput.trim();
                    setPending(null);
                    if (name && name !== node.name) await doRename(node, name);
                  } else if (e.key === 'Escape') {
                    setPending(null);
                  }
                }}
                onBlur={() => setPending(null)}
              />
            ) : (
              <span className="name">{node.name}</span>
            )}
          </div>
          {node.isDirectory && isExpanded && renderTree(node.path, level + 1)}
          {pending &&
            pending.kind !== 'rename' &&
            pending.parentPath === node.path &&
            node.isDirectory &&
            isExpanded && (
              <div className="tree-node file" style={{ paddingLeft: 8 + (level + 1) * 12 }}>
                <span className="twisty"></span>
                <img
                  className="file-icon"
                  src={pending.kind === 'newDir' ? folderIconUrl('', false) : fileIconUrl('')}
                  alt=""
                />
                <input
                  autoFocus
                  className="explorer-input"
                  value={pendingInput}
                  onChange={(e) => setPendingInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const name = pendingInput.trim();
                      const kind = pending.kind;
                      const parent = pending.parentPath;
                      setPending(null);
                      if (name) await doCreate(parent, name, kind === 'newDir');
                    } else if (e.key === 'Escape') {
                      setPending(null);
                    }
                  }}
                  onBlur={() => setPending(null)}
                />
              </div>
            )}
        </div>
      );
    });
  }

  return (
    <div className="explorer" onClick={() => setCtxMenu(null)}>
      <div className="explorer-header section-explorer">
        <span className="section-glyph">⌥</span>
        <span>Explorer{project ? ` — ${project.displayName}` : ''}</span>
      </div>
      <div
        className="explorer-body"
        ref={containerRef}
        tabIndex={0}
        onContextMenu={(e) => ctxMenuFor(e, null)}
      >
        {!project ? (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>
            No project selected.
          </div>
        ) : !project.exists ? (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>
            Directory not found on disk.
          </div>
        ) : !rootPath ? null : (
          <>
            {/* Root-level new-file/folder pending entry */}
            {pending && pending.kind !== 'rename' && pending.parentPath === rootPath && (
              <div className="tree-node file" style={{ paddingLeft: 8 }}>
                <span className="twisty"></span>
                <img
                  className="file-icon"
                  src={pending.kind === 'newDir' ? folderIconUrl('', false) : fileIconUrl('')}
                  alt=""
                />
                <input
                  autoFocus
                  className="explorer-input"
                  value={pendingInput}
                  onChange={(e) => setPendingInput(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const name = pendingInput.trim();
                      const kind = pending.kind;
                      setPending(null);
                      if (name) await doCreate(rootPath, name, kind === 'newDir');
                    } else if (e.key === 'Escape') {
                      setPending(null);
                    }
                  }}
                  onBlur={() => setPending(null)}
                />
              </div>
            )}
            {renderTree(rootPath, 0)}
          </>
        )}
      </div>
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="ctx-menu-item"
            onClick={() => {
              setPending({ kind: 'newFile', parentPath: ctxTargetDir });
              setPendingInput('');
              if (ctxTargetDir !== rootPath) setExpanded((cur) => new Set(cur).add(ctxTargetDir));
              setCtxMenu(null);
            }}
          >
            New File
          </div>
          <div
            className="ctx-menu-item"
            onClick={() => {
              setPending({ kind: 'newDir', parentPath: ctxTargetDir });
              setPendingInput('');
              if (ctxTargetDir !== rootPath) setExpanded((cur) => new Set(cur).add(ctxTargetDir));
              setCtxMenu(null);
            }}
          >
            New Folder
          </div>
          {ctxMenu.node && (
            <>
              <div className="ctx-menu-divider" />
              <div
                className="ctx-menu-item"
                onClick={() => {
                  setPending({ kind: 'rename', node: ctxMenu.node! });
                  setPendingInput(ctxMenu.node!.name);
                  setCtxMenu(null);
                }}
              >
                Rename
              </div>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  setClipboard({ mode: 'copy', paths: [ctxMenu.node!.path] });
                  setCtxMenu(null);
                }}
              >
                Copy
              </div>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  setClipboard({ mode: 'cut', paths: [ctxMenu.node!.path] });
                  setCtxMenu(null);
                }}
              >
                Cut
              </div>
            </>
          )}
          {clipboard && clipboard.paths.length > 0 && (
            <div
              className="ctx-menu-item"
              onClick={() => {
                void doPaste(ctxTargetDir);
                setCtxMenu(null);
              }}
            >
              Paste
            </div>
          )}
          {ctxMenu.node && (
            <>
              <div className="ctx-menu-divider" />
              <div
                className="ctx-menu-item"
                onClick={() => {
                  void window.api.fs.openDefault(ctxMenu.node!.path);
                  setCtxMenu(null);
                }}
              >
                Open
              </div>
              <div
                className="ctx-menu-item"
                onClick={() => {
                  void window.api.fs.reveal(ctxMenu.node!.path);
                  setCtxMenu(null);
                }}
              >
                Reveal in File Explorer
              </div>
              <div className="ctx-menu-divider" />
              <div
                className="ctx-menu-item danger"
                onClick={() => {
                  setConfirmDelete(ctxMenu.node);
                  setCtxMenu(null);
                }}
              >
                Delete (move to Recycle Bin)
              </div>
            </>
          )}
        </div>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          message={`This will move "${confirmDelete.path}" to the system Recycle Bin. You can restore it from there.`}
          confirmText="Move to Recycle Bin"
          typeToConfirm={confirmDelete.name}
          destructive
          onConfirm={async () => {
            const n = confirmDelete;
            setConfirmDelete(null);
            await window.api.fs.trash(n.path);
            refreshParentOf(n.path);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
