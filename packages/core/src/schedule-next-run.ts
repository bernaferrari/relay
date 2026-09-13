const MINUTE_MS = 60_000;
const MAX_SEARCH_MS = 50 * 60 * MINUTE_MS;

function zonedClock(
  at: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const number = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value);
  };
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
  };
}

export function assertIanaTimeZone(timeZone: string): string {
  const zone = timeZone.trim();
  if (!zone) throw new Error("timezone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
  } catch {
    throw new Error(`timezone ${zone} is not a valid IANA name`);
  }
  return zone;
}

/** Next due time. Hour is wall-clock in `timezone` (UTC when omitted). */
export function computeScheduleNextRunAt(
  now: number,
  intervalMinutes: number,
  hour?: number,
  timezone?: string,
): number {
  if (hour === undefined) return now + intervalMinutes * MINUTE_MS;
  const zone = timezone ? assertIanaTimeZone(timezone) : "UTC";
  for (let at = now + MINUTE_MS; at <= now + MAX_SEARCH_MS; at += MINUTE_MS) {
    const clock = zonedClock(at, zone);
    if (clock.hour === hour && clock.minute === 0) return at;
  }
  return now + intervalMinutes * MINUTE_MS;
}
