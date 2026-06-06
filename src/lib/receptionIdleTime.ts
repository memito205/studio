export function buildReceptionIdleEntryId(userId: string, fromMs: number): string {
  return `${userId}-${fromMs}`;
}

export function justifiedIdleIntervalMs(entry: {
  fromMs: number;
  toMs: number;
  customDuration?: number;
}): { start: number; end: number } {
  const fullMs = entry.toMs - entry.fromMs;
  const justifiedMs = entry.customDuration != null
    ? Math.min(fullMs, Math.max(0, entry.customDuration * 60000))
    : fullMs;
  return { start: entry.fromMs, end: entry.fromMs + justifiedMs };
}
