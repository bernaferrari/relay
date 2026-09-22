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
