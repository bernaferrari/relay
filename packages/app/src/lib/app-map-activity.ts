import type { ActivityEvent } from "@relay/protocol";

export type ActivityRow = { event: ActivityEvent; count: number };

/** Collapse only adjacent autosaves from the same actor within one editing burst. */
export function collapseActivity(events: readonly ActivityEvent[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of [...events].sort((left, right) => right.at - left.at)) {
    const previous = rows.at(-1);
    if (
      previous &&
      previous.event.actorId === event.actorId &&
      previous.event.summary === event.summary &&
      previous.event.eventType === event.eventType &&
      previous.event.at - event.at <= 2 * 60_000
    ) {
      previous.count += 1;
      continue;
    }
    rows.push({ event, count: 1 });
  }
  return rows;
}

export function activitySummary(event: ActivityEvent): string {
  if (event.summary === "Updated map" || event.summary === "Updated App Map canvas") {
    return "Edited map";
  }
  if (event.eventType === "screen.updated" && /^Updated screen\s+\S+$/u.test(event.summary)) {
    return "Updated screen";
  }
  return event.summary;
}
