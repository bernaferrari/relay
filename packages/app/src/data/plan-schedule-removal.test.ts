import { expect, it, vi } from "vitest";
import { createSuiteProfileProductService } from "./suite-profile-product-service";
const relay = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client: relay })),
}));
it("deletes only the requested saved schedule through the public operation", async () => {
  relay.invoke.mockResolvedValue({ ok: true });
  await createSuiteProfileProductService({} as never).removePlanSchedule!("daily-123");
  expect(relay.invoke).toHaveBeenCalledExactlyOnceWith("schedule.delete", {
    scheduleId: "daily-123",
  });
});

it("pauses the exact schedule while preserving timing and target setup", async () => {
  relay.invoke.mockReset();
  const saved = {
    id: "s",
    appMapId: "app",
    combineId: "plan",
    targetKind: "device",
    targetId: "d",
    platform: "android",
    intervalMinutes: 30,
    timezone: "UTC",
    repetitions: 2,
    enabled: true,
  };
  relay.invoke
    .mockResolvedValueOnce({ schedules: [saved] })
    .mockResolvedValueOnce({ schedule: { ...saved, enabled: false } });
  await createSuiteProfileProductService({} as never).setPlanScheduleEnabled!({
    id: "s",
    appMapId: "app",
    combineId: "plan",
    enabled: false,
  });
  expect(relay.invoke).toHaveBeenLastCalledWith("schedule.create", { ...saved, enabled: false });
});
it("refuses to pause a schedule belonging to another plan", async () => {
  relay.invoke.mockReset();
  relay.invoke.mockResolvedValueOnce({
    schedules: [{ id: "s", appMapId: "app", combineId: "other" }],
  });
  await expect(
    createSuiteProfileProductService({} as never).setPlanScheduleEnabled!({
      id: "s",
      appMapId: "app",
      combineId: "plan",
      enabled: false,
    }),
  ).rejects.toThrow("changed");
  expect(relay.invoke).toHaveBeenCalledTimes(1);
});
