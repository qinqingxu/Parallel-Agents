import {
  app,
  BrowserWindow,
  shell,
  Tray,
  Menu,
  dialog,
  globalShortcut,
  nativeImage,
} from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { registerIpc } from './ipc.ts';
import { ptyManager } from './pty-manager.ts';
import * as git from './git.ts';
import { UpdateController } from './update-controller.ts';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let quitInProgress = false;
let updates: UpdateController;
const APP_USER_MODEL_ID = 'com.jelllove.parallelagents';

function prepareToQuit(): void {
  isQuitting = true;
  ptyManager.detachWindow();
  git.detachWindow();
  git.unwatchAll();
  ptyManager.killAll();
}

function getIconPath(name: string): string {
  const candidates = app.isPackaged
    ? [
        // Preferred: copied via electron-builder extraResources.
        join(process.resourcesPath, name),
        // Backward-compatible fallback for previous package layouts.
        join(app.getAppPath(), 'resources', name),
      ]
    : [join(__dirname, '../../resources', name)];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

function createWindow(): void {
  const windowIcon = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    autoHideMenuBar: true,
    title: 'Parallel Agents',
    icon: getIconPath(windowIcon),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', false);
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  registerIpc(mainWindow, updates);
}

function showOrFocus(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

async function quitWithConfirm(install?: () => void): Promise<boolean> {
  if (quitInProgress || isQuitting) return false;
  quitInProgress = true;
  try {
    // Never install without a visible confirmation, even if the renderer cannot
    // report its tabs (a failed renderer does not imply there are no agents).
    if (install && (!mainWindow || mainWindow.isDestroyed())) {
      throw new Error('Open the application window before restarting to update.');
    }
    const tabs: string[] = mainWindow
      ? await mainWindow.webContents
          .executeJavaScript('window.__getOpenTabs ? window.__getOpenTabs() : []')
          .catch(() => [])
      : [];

    if (mainWindow && (tabs.length > 0 || install)) {
      showOrFocus();
      const list = tabs.map((t, i) => `  ${i + 1}. ${t}`).join('\n');
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: install ? 'Restart to update Parallel Agents' : 'Quit Parallel Agents',
        message: install
          ? 'Close all agent sessions and restart to install the update?'
          : 'Close all open agent sessions and quit?',
        detail: `Open sessions (${tabs.length}):\n${list}${install ? '\n\nAll running agents and terminals will be stopped. Save your work before continuing.' : ''}`,
        buttons: [install ? 'Close all & restart' : 'Close all & quit', 'Cancel'],
        defaultId: install ? 1 : 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return false;
    }
    prepareToQuit();
    if (install) install();
    else app.quit();
    return true;
  } finally {
    quitInProgress = false;
  }
}

function createTray(): void {
  const trayImage = nativeImage.createFromPath(getIconPath('tray-icon.png'));
  const image = trayImage.isEmpty()
    ? nativeImage.createFromPath(getIconPath('app-icon.png'))
    : trayImage;
  tray = new Tray(image);
  tray.setToolTip('Parallel Agents');

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleVisibility() },
    { type: 'separator' },
    { label: 'Quit', click: () => quitWithConfirm() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showOrFocus());
}

function toggleVisibility(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showOrFocus();
  }
}

app.whenReady().then(async () => {
  const { default: electronUpdater } = await import('electron-updater');
  const { autoUpdater } = electronUpdater;
  updates = new UpdateController({
    updater: autoUpdater,
    enabled: app.isPackaged && process.platform === 'win32',
    currentVersion: app.getVersion(),
    confirmAndInstall: (install) => quitWithConfirm(install),
    onInstallError: () => {
      isQuitting = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        ptyManager.attachWindow(mainWindow);
        git.attachWindow(mainWindow);
      }
    },
  });
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  createWindow();
  createTray();
  updates.start();

  globalShortcut.register('F11', () => {
    if (mainWindow && mainWindow.isFocused()) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showOrFocus();
  });
});

app.on('window-all-closed', () => {
  // Registering a listener keeps the tray app alive; this event is not cancelable.
});

app.on('before-quit', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    quitWithConfirm();
    return;
  }
  prepareToQuit();
});

app.on('will-quit', () => {
  updates?.dispose();
  globalShortcut.unregisterAll();
});
