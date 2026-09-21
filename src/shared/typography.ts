export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const TERMINAL_FONT_FAMILY = 'Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, monospace';

export function validateFontSize(size: number): number {
  if (!Number.isInteger(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) {
    throw new Error(`Font size must be an integer from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.`);
  }
  return size;
}
