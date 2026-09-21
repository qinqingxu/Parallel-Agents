import type { AppUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types.ts';

export const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

type Updater = Pick<
  AppUpdater,
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowPrerelease'
  | 'allowDowngrade'
  | 'checkForUpdates'
  | 'quitAndInstall'
  | 'on'
  | 'removeListener'
>;
type UpdaterEvent = Parameters<Updater['on']>[0];
type UpdaterListener = Parameters<Updater['on']>[1];

interface UpdateOptions {
  updater: Updater;
  enabled: boolean;
  currentVersion: string;
  confirmAndInstall: (install: () => void) => Promise<boolean>;
  onInstallError?: () => void;
}

export class UpdateController {
  private status: UpdateStatus;
  private listeners = new Set<(status: UpdateStatus) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;
  private requestingInstall = false;
  private started = false;
  private handlers: [UpdaterEvent, UpdaterListener][] = [];

  constructor(private readonly options: UpdateOptions) {
    options.updater.autoDownload = true;
    options.updater.autoInstallOnAppQuit = false;
    options.updater.allowPrerelease = false;
    options.updater.allowDowngrade = false;
    this.status = {
      state: options.enabled ? 'idle' : 'unavailable',
      currentVersion: options.currentVersion,
      canInstall: false,
      message: options.enabled
        ? undefined
        : 'Automatic updates are available only in packaged Windows builds.',
    };
    if (!options.enabled) return;
    this.listen('checking-for-update', () =>
      this.setStatus({ state: 'checking', message: undefined, percent: undefined }),
    );
    this.listen('update-available', (info: { version: string }) =>
      this.setStatus({ state: 'available', version: info.version }),
    );
    this.listen('update-not-available', () =>
      this.setStatus({ state: 'idle', version: undefined, message: 'You are up to date.' }),
    );
    this.listen('download-progress', (progress: { percent: number }) =>
      this.setStatus({
        state: 'downloading',
        percent: Math.min(100, Math.max(0, progress.percent)),
      }),
    );
    this.listen('update-downloaded', (info: { version: string }) =>
      this.setStatus({
        state: 'downloaded',
        version: info.version,
        percent: 100,
        canInstall: true,
        message: undefined,
      }),
    );
    this.listen('error', (error: Error) => this.fail(error));
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (!this.options.enabled || this.started) return;
    this.started = true;
    void this.check();
    this.timer = setInterval(() => {
      void this.check();
    }, UPDATE_CHECK_INTERVAL);
    this.timer.unref?.();
  }

  async check(): Promise<UpdateStatus> {
    if (!this.options.enabled || this.checking || this.status.canInstall || this.requestingInstall)
      return this.getStatus();
    this.checking = true;
    this.setStatus({ state: 'checking', message: undefined, percent: undefined });
    try {
      const result = await this.options.updater.checkForUpdates();
      if (!result) throw new Error('The updater could not check this installation.');
      // electron-updater returns the automatic download separately from the check.
      // Always handle that rejection as well as its error event.
      await result.downloadPromise;
    } catch (error) {
      this.fail(error);
    } finally {
      this.checking = false;
    }
    return this.getStatus();
  }

  async install(): Promise<UpdateStatus> {
    if (
      !this.options.enabled ||
      !this.status.canInstall ||
      this.requestingInstall ||
      this.status.state === 'installing'
    ) {
      return this.getStatus();
    }
    this.requestingInstall = true;
    try {
      await this.options.confirmAndInstall(() => {
        this.setStatus({ state: 'installing', message: undefined });
        this.options.updater.quitAndInstall(false, true);
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.requestingInstall = false;
    }
    return this.getStatus();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const [event, handler] of this.handlers)
      this.options.updater.removeListener(event, handler);
    this.handlers = [];
    this.listeners.clear();
  }

  private listen<T extends unknown[]>(event: UpdaterEvent, handler: (...args: T) => void): void {
    const listener = handler as UpdaterListener;
    this.options.updater.on(event, listener);
    this.handlers.push([event, listener]);
  }

  private fail(error: unknown): void {
    if (this.status.state === 'installing') this.options.onInstallError?.();
    this.setStatus({
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private setStatus(change: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...change };
    for (const listener of this.listeners) listener(this.getStatus());
  }
}
