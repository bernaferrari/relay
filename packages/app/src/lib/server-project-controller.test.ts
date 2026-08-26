import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
import type { LocalSchedule } from "./api-types";
import { createServerProjectController } from "./server-project-controller";

const schedule: LocalSchedule = {
  id: "schedule-1",
  recipeId: "smoke",
  targetKind: "device",
  targetId: "pixel",
  platform: "android",
  intervalMinutes: 15,
  repetitions: 1,
  enabled: true,
  projectId: "default",
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
};

test("schedule operations use the typed Relay operation registry", async () => {
  const calls: Array<{ operationId: string; input: unknown }> = [];
  const client = {
    invoke: async (operationId: string, input: unknown) => {
      calls.push({ operationId, input });
      if (operationId === "schedule.list") return { schedules: [schedule] };
      if (operationId === "schedule.delete") return { ok: true };
      return { schedule };
    },
  } as unknown as RelayClient;
  const controller = createServerProjectController({
    client: async () => client,
    currentClient: () => client,
    health: () => "online",
    selectedDevice: () => "pixel",
    devices: () => [{ serial: "pixel", platform: "android" }],
  });

  await controller.scheduleRecipe({ recipeId: "smoke", intervalMinutes: 15 });
  await controller.refreshSchedules();
  await controller.deleteLocalSchedule(schedule.id);

  assert.deepEqual(calls, [
    {
      operationId: "schedule.create",
      input: {
        recipeId: "smoke",
        intervalMinutes: 15,
        targetKind: "device",
        targetId: "pixel",
        platform: "android",
      },
    },
    { operationId: "schedule.list", input: {} },
    { operationId: "schedule.delete", input: { scheduleId: "schedule-1" } },
  ]);
  assert.deepEqual(controller.schedules(), []);
});
