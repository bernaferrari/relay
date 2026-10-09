import { describe, expect, it } from "vitest";
import { capitalizedRelativeTime, relativeTime } from "./relative-time";

const now = new Date(2026, 9, 9, 12, 0).getTime();

describe("relativeTime", () => {
  it("reads inside a sentence and rounds down", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - (2 * 3_600_000 + 59 * 60_000), now)).toBe("2h ago");
    expect(relativeTime(now - (2 * 86_400_000 + 23 * 3_600_000), now)).toBe("2d ago");
  });

  it("never claims a future time", () => {
    expect(relativeTime(now + 2 * 86_400_000, now)).toBe("just now");
  });

  it("switches to a date after a week, adding the year only when it differs", () => {
    expect(relativeTime(new Date(2026, 8, 1).getTime(), now)).toMatch(/Sep|1/u);
    expect(relativeTime(new Date(2025, 8, 1).getTime(), now)).toMatch(/2025/u);
  });

  it("capitalizes for the start of a line", () => {
    expect(capitalizedRelativeTime(now, now)).toBe("Just now");
  });
});
