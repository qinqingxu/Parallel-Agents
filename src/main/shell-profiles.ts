import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

export interface ShellLaunch {
  command: string;
  args: string[];
}

export interface AvailableShell {
  id: string;
  label: string;
  command: string;
  args: string[];
}

export function resolveShellLaunch(
  platform: NodeJS.Platform,
  profile: string,
  envShell: string | null,
): ShellLaunch {
  if (platform === 'win32') {
    if (profile === 'bash') return { command: 'bash.exe', args: [] };
    if (profile === 'cmd') return { command: 'cmd.exe', args: [] };
    if (profile === 'powershell') return { command: 'pwsh.exe', args: [] };
    return { command: 'powershell.exe', args: [] };
  }

  if (profile === 'bash') return { command: 'bash', args: ['-l'] };
  const command = envShell && envShell.trim() ? envShell : 'bash';
  return { command, args: ['-l'] };
}

export interface ShellDiscoveryProbes {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  isExecutable: (command: string) => Promise<boolean>;
  readShells: () => Promise<string>;
  execFile: (command: string, args: string[]) => Promise<string | Buffer>;
  diagnostic: (message: string) => void;
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function decodeOutput(output: string | Buffer | undefined): string {
  if (!output) return '';
  if (typeof output === 'string') return output.replace(/\0/g, '').replace(/^\uFEFF/, '');
  const utf16 = (output[0] === 0xff && output[1] === 0xfe) || output.includes(0);
  return output.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}

const shellNames = new Set([
  'sh',
  'bash',
  'dash',
  'zsh',
  'ksh',
  'ksh93',
  'tcsh',
  'csh',
  'fish',
  'pwsh',
  'nu',
  'yash',
  'ash',
  'elvish',
  'xonsh',
  'oil',
  'osh',
]);

export function createShellDiscovery(overrides: Partial<ShellDiscoveryProbes> = {}) {
  const probes: ShellDiscoveryProbes = {
    platform: process.platform,
    env: process.env,
    async isExecutable(command) {
      try {
        if (!(await stat(command)).isFile()) return false;
        await access(command, probes.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
      } catch (error) {
        if (missing(error) || (error as NodeJS.ErrnoException).code === 'EACCES') return false;
        throw error;
      }
    },
    async readShells() {
      try {
        return await readFile('/etc/shells', 'utf8');
      } catch (error) {
        if (missing(error)) return '';
        throw error;
      }
    },
    execFile(command, args) {
      return new Promise<Buffer>((resolve, reject) => {
        execFile(
          command,
          args,
          {
            encoding: 'buffer',
            timeout: 3000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stdout, stderr }));
            else resolve(stdout);
          },
        );
      });
    },
    diagnostic: (message) => console.warn(`[shell-discovery] ${message}`),
    ...overrides,
  };
  const windows = probes.platform === 'win32';
  const paths = windows ? win32 : posix;
  const env = (name: string): string | undefined => {
    const key = windows
      ? Object.keys(probes.env).find((key) => key.toLowerCase() === name.toLowerCase())
      : name;
    return key ? probes.env[key] : undefined;
  };

  async function discoverShells(): Promise<AvailableShell[]> {
    const pathDirectories = (env('PATH') ?? '')
      .split(paths.delimiter)
      .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
      .filter((entry) => paths.isAbsolute(entry))
      .slice(0, 128);
    const checked = new Map<string, Promise<boolean>>();
    async function firstExecutable(candidates: string[]): Promise<string | undefined> {
      for (const candidate of candidates) {
        if (!paths.isAbsolute(candidate)) continue;
        const command = paths.normalize(candidate);
        const key = windows ? command.toLowerCase() : command;
        if (!checked.has(key)) checked.set(key, probes.isExecutable(command));
        if (await checked.get(key)) return command;
      }
      return undefined;
    }
    const onPath = (name: string) => pathDirectories.map((dir) => paths.join(dir, name));
    const result: AvailableShell[] = [];
    async function add(id: string, label: string, candidates: string[], args: string[] = []) {
      if (result.some((shell) => shell.id === id)) return;
      const command = await firstExecutable(candidates);
      if (command) result.push({ id, label, command, args });
    }

    if (windows) {
      const systemRoot = env('SystemRoot') || env('WINDIR') || 'C:\\Windows';
      const system32 = paths.join(systemRoot, 'System32');
      const programFiles = [
        ...new Set(
          [
            env('ProgramW6432'),
            env('ProgramFiles'),
            env('ProgramFiles(x86)'),
            'C:\\Program Files',
            'C:\\Program Files (x86)',
          ].filter((value): value is string => Boolean(value)),
        ),
      ];
      await add('cmd', 'Command Prompt', [paths.join(system32, 'cmd.exe'), ...onPath('cmd.exe')]);
      await add('powershell', 'Windows PowerShell', [
        paths.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ...onPath('powershell.exe'),
      ]);
      await add('pwsh', 'PowerShell', [
        ...onPath('pwsh.exe'),
        ...programFiles.map((dir) => paths.join(dir, 'PowerShell', '7', 'pwsh.exe')),
      ]);
      const git = await firstExecutable(onPath('git.exe'));
      const gitRoot = git ? paths.dirname(paths.dirname(git)) : undefined;
      await add(
        'bash',
        'Git Bash',
        [
          // System32/bash.exe is a legacy WSL launcher, not an installed Git Bash.
          ...onPath('bash.exe').filter(
            (command) => paths.dirname(command).toLowerCase() !== system32.toLowerCase(),
          ),
          ...programFiles.map((dir) => paths.join(dir, 'Git', 'bin', 'bash.exe')),
          ...(gitRoot
            ? [
                paths.join(gitRoot, 'bin', 'bash.exe'),
                paths.join(gitRoot, 'usr', 'bin', 'bash.exe'),
                paths.join(gitRoot, '..', 'bin', 'bash.exe'),
              ]
            : []),
        ],
        ['--login', '-i'],
      );
      await add('nu', 'Nushell', onPath('nu.exe'));
      const wsl = await firstExecutable([paths.join(system32, 'wsl.exe'), ...onPath('wsl.exe')]);
      if (wsl) {
        let output: string;
        try {
          output = decodeOutput(await probes.execFile(wsl, ['--list', '--quiet']));
        } catch (error) {
          const failure = error as NodeJS.ErrnoException & {
            stdout?: Buffer | string;
            stderr?: Buffer | string;
            killed?: boolean;
          };
          const detail = `${decodeOutput(failure.stdout)}\n${decodeOutput(failure.stderr)}\n${failure.message}`;
          const unavailable =
            /WSL_E_(?:WSL_OPTIONAL_COMPONENT_REQUIRED|WSL_NOT_INSTALLED|DEFAULT_DISTRO_NOT_FOUND)|0x8007019e|no installed distributions|wsl(?:\.exe)? --install/i.test(
              detail,
            );
          if (missing(error) || (!failure.killed && unavailable)) {
            probes.diagnostic('WSL is unavailable or has no installed distributions.');
            return result;
          }
          throw error;
        }
        const distributions = [
          ...new Set(
            output
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          ),
        ];
        if (!distributions.length) probes.diagnostic('WSL has no installed distributions.');
        for (const name of distributions) {
          result.push({
            id: `wsl:${name}`,
            label: `WSL: ${name}`,
            command: wsl,
            args: ['--distribution', name],
          });
        }
      }
      return result;
    }

    const listed = (await probes.readShells())
      .split(/\r?\n/)
      .slice(0, 512)
      .map((line) => line.split('#')[0].trim())
      .filter((line) => paths.isAbsolute(line));
    const candidates = [
      ...listed,
      ...['bash', 'zsh', 'fish', 'pwsh', 'nu'].flatMap(onPath),
      ...(env('SHELL') ? [env('SHELL')!] : []),
    ];
    for (const command of candidates) {
      const name = paths.basename(command);
      if (!shellNames.has(name)) continue;
      const label = name === 'pwsh' ? 'PowerShell' : name === 'nu' ? 'Nushell' : name;
      await add(name, label, [command], name === 'pwsh' || name === 'nu' ? [] : ['-l']);
    }
    return result;
  }

  async function resolveAvailableShell(profile: string): Promise<ShellLaunch> {
    if (profile === 'default') {
      return resolveShellLaunch(probes.platform, 'default', env('SHELL') ?? null);
    }
    const shell = (await discoverShells()).find((shell) => shell.id === profile);
    if (!shell) throw new Error(`Shell profile "${profile}" is not installed or available.`);
    return { command: shell.command, args: [...shell.args] };
  }

  return { discoverShells, resolveAvailableShell };
}

export async function discoverShells(): Promise<AvailableShell[]> {
  return createShellDiscovery().discoverShells();
}

export async function resolveAvailableShell(profile: string): Promise<ShellLaunch> {
  return createShellDiscovery().resolveAvailableShell(profile);
}
