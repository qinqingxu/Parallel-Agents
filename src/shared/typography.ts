export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_FAMILY = 'default';
export const FONT_FAMILY_OPTIONS = [
  {
    id: DEFAULT_FONT_FAMILY,
    label: 'Default monospace',
    family: 'Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, monospace',
  },
  {
    id: 'cascadia-mono',
    label: 'Cascadia Mono',
    family: '"Cascadia Mono", Consolas, monospace',
  },
  {
    id: 'consolas',
    label: 'Consolas',
    family: 'Consolas, "Cascadia Mono", monospace',
  },
  {
    id: 'courier-new',
    label: 'Courier New',
    family: '"Courier New", monospace',
  },
  {
    id: 'lucida-console',
    label: 'Lucida Console',
    family: '"Lucida Console", monospace',
  },
  {
    id: 'monospace',
    label: 'System monospace',
    family: 'monospace',
  },
] as const;
export type FontFamilyId = (typeof FONT_FAMILY_OPTIONS)[number]['id'];
export const TERMINAL_FONT_FAMILY = FONT_FAMILY_OPTIONS[0].family;

export function validateFontSize(size: number): number {
  if (!Number.isInteger(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) {
    throw new Error(`Font size must be an integer from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`);
  }
  return size;
}

export function validateFontFamily(fontFamily: string): FontFamilyId {
  if (FONT_FAMILY_OPTIONS.some((option) => option.id === fontFamily)) {
    return fontFamily as FontFamilyId;
  }
  throw new Error(
    `Font family must be one of: ${FONT_FAMILY_OPTIONS.map((option) => option.id).join(', ')}.`,
  );
}

export function resolveFontFamily(fontFamily: FontFamilyId): string {
  return (
    FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamily)?.family ?? TERMINAL_FONT_FAMILY
  );
}
