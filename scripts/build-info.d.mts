export interface BuildInfo {
  version: string;
  commit: string | null;
  dirty: boolean;
}

export function getBuildInfo(root: string): BuildInfo;
