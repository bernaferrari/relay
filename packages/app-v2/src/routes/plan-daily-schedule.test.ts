import { describe, expect, it } from "vitest";
import { planScheduleStatus, planScheduleWhen } from "./plan-daily-schedule";

describe("plan daily schedule status", () => {
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
