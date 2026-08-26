import { createSignal, type Accessor } from "solid-js";
import { ApiError, type RelayClient } from "@relay/client";
import type {
  GenerationRequest,
  GenerationResult,
  OperationInput,
  Revisioned,
  TestData,
} from "@relay/protocol";
import { toast } from "../context/toast";
import type { DeviceInfo, LocalSchedule } from "./api-types";

export function createServerProjectController(input: {
  client: () => Promise<RelayClient>;
  currentClient: Accessor<RelayClient | null>;
  health: Accessor<"unknown" | "online" | "offline">;
  selectedDevice: Accessor<string | null>;
  devices: Accessor<DeviceInfo[]>;
}) {
  const [projectVariables, setProjectVariables] = createSignal<Revisioned<TestData[]>>({
    revision: 0,
    value: [],
    updatedAt: 0,
  });
  const [schedules, setSchedules] = createSignal<LocalSchedule[]>([]);

  async function refreshProjectVariables(): Promise<void> {
    const client = input.currentClient();
    if (!client || input.health() === "offline") return;
    try {
      setProjectVariables(await client.variables());
    } catch {
      /* project data is non-critical to device connectivity */
    }
  }

  async function saveProjectVariables(value: TestData[]): Promise<void> {
    const client = await input.client();
    const before = projectVariables();
    const optimistic = {
      ...before,
      revision: before.revision + 1,
      value,
      updatedAt: Date.now(),
    };
    setProjectVariables(optimistic);
    try {
      setProjectVariables(
        await client.updateVariables({
          expectedRevision: before.revision,
          value,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.body as { current?: Revisioned<TestData[]> })?.current;
        if (current) {
          const localById = new Map(value.map((item) => [item.id, item]));
          const merged = [
            ...current.value.map((item) => localById.get(item.id) ?? item),
            ...value.filter((item) => !current.value.some((remote) => remote.id === item.id)),
          ];
          setProjectVariables(
            await client.updateVariables({
              expectedRevision: current.revision,
              value: merged,
              idempotencyKey: crypto.randomUUID(),
            }),
          );
          toast("Variables merged with newer project changes", "info");
          return;
        }
      }
      setProjectVariables(before);
      throw error;
    }
  }

  async function generate(request: GenerationRequest): Promise<GenerationResult> {
    return (await input.client()).generate(request);
  }

  async function scheduleRecipe(inputValue: {
    recipeId: string;
    intervalMinutes: number;
    repetitions?: number;
  }): Promise<LocalSchedule> {
    const targetId = input.selectedDevice();
    if (!targetId) throw new Error("Select a target before scheduling");
    const targetPlatform =
      input.devices().find((device) => device.serial === targetId)?.platform ?? "android";
    const scheduleInput: OperationInput<"schedule.create"> = {
      ...inputValue,
      targetKind: targetPlatform === "browser" ? "browser" : "device",
      targetId,
      platform: targetPlatform,
    };
    const data = await (await input.client()).invoke("schedule.create", scheduleInput);
    setSchedules((items) => [
      ...items.filter((item) => item.id !== data.schedule.id),
      data.schedule,
    ]);
    return data.schedule;
  }

  async function refreshSchedules(): Promise<void> {
    if (input.health() === "offline") return;
    const data = await (await input.client()).invoke("schedule.list", {});
    setSchedules(data.schedules ?? []);
  }

  async function deleteLocalSchedule(id: string): Promise<void> {
    await (await input.client()).invoke("schedule.delete", { scheduleId: id });
    setSchedules((items) => items.filter((item) => item.id !== id));
  }

  return {
    projectVariables,
    refreshProjectVariables,
    saveProjectVariables,
    generate,
    schedules,
    scheduleRecipe,
    refreshSchedules,
    deleteLocalSchedule,
  };
}
