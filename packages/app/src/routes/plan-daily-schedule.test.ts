import { describe, expect, it } from "vitest";
import { planScheduleFrequency, planScheduleStatus, planScheduleWhen } from "./plan-daily-schedule";

describe("plan daily schedule status", () => {
  it("displays the saved recurrence without inventing a daily time", () => {
    const base = { id: "schedule", enabled: true, nextRunAt: 1 };
    expect(planScheduleFrequency({ ...base, intervalMinutes: 30 })).toBe("Every 30 minutes");
    expect(planScheduleFrequency({ ...base, intervalMinutes: 60 })).toBe("Hourly");
    expect(planScheduleFrequency({ ...base, intervalMinutes: 1_440, hour: 8 })).toBe(
      "Daily at 8:00 AM",
    );
    expect(planScheduleFrequency({ ...base, intervalMinutes: 90 })).toBe("Every 90 minutes");
    expect(planScheduleFrequency({ ...base, intervalMinutes: 1_440 })).toBe("Every 24 hours");
  });
  it("formats next and last run in the saved timezone", () => {
    expect(planScheduleWhen(Date.UTC(2026, 8, 18, 8), "UTC")).toBe("Fri, Sep 18, 8:00 AM");
    expect(
      planScheduleStatus({
        id: "sched-1",
        timezone: "UTC",
        nextRunAt: Date.UTC(2026, 8, 18, 8),
        lastRunAt: Date.UTC(2026, 8, 17, 8),
        enabled: true,
      }),
    ).toEqual({
      next: "Fri, Sep 18, 8:00 AM",
      last: "Thu, Sep 17, 8:00 AM",
    });
  });

  it("keeps a never-run schedule and admission failure as Infra", () => {
    expect(
      planScheduleStatus({
        id: "sched-1",
        timezone: "UTC",
        nextRunAt: Date.UTC(2026, 8, 18, 8),
        lastFailure: "That browser is offline",
        enabled: true,
      }),
    ).toEqual({
      next: "Fri, Sep 18, 8:00 AM",
      last: "Never",
      failure: "Last run could not start: That browser is offline",
    });
  });
});
