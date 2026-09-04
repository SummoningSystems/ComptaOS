export function parseLocalizedNumber(value: string): number | undefined {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function clampNumber(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}
