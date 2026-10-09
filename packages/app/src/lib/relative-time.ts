/** One way to say how long ago something happened, everywhere in Relay.
 * Lowercase so it reads inside a sentence ("Updated just now"); use
 * `capitalizedRelativeTime` where it starts a line. Future times (clock skew
 * between machines) read as "just now", never "in 2 days". */
export function relativeTime(at: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  const date = new Date(at);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

export function capitalizedRelativeTime(at: number, now = Date.now()): string {
  const value = relativeTime(at, now);
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
