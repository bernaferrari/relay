export function formatObservedDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 90) return `about ${seconds}s`;
  const minutes = seconds / 60;
  const rounded = minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10;
  return `about ${rounded} min`;
}
