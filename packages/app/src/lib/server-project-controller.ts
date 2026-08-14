import { createSignal, type Accessor } from "solid-js";
import { ApiError, type RelayClient } from "@relay/client";
import type { GenerationRequest, GenerationResult, Revisioned, TestData } from "@relay/protocol";
import { toast } from "../context/toast";
import type { DeviceInfo, LocalSchedule } from "./api-types";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export function createServerProjectController(input: {
  request: Request;
  client: () => Promise<RelayClient>;
  currentClient: Accessor<RelayClient | null>;
  health: Accessor<"unknown" | "online" | "offline">;
  selectedDevice: Accessor<string | null>;
  devices: Accessor<DeviceInfo[]>;
  projectId: () => string;
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
    const data = await input.request<{ schedule: LocalSchedule }>("/schedules", {
      method: "POST",
      body: JSON.stringify({
        ...inputValue,
        targetKind: targetPlatform === "browser" ? "browser" : "device",
        targetId,
        platform: targetPlatform,
        projectId: input.projectId(),
      }),
    });
    setSchedules((items) => [
      ...items.filter((item) => item.id !== data.schedule.id),
      data.schedule,
    ]);
    return data.schedule;
  }

  async function refreshSchedules(): Promise<void> {
    if (input.health() === "offline") return;
    const data = await input.request<{ schedules: LocalSchedule[] }>("/schedules");
    setSchedules(data.schedules ?? []);
  }

  async function deleteLocalSchedule(id: string): Promise<void> {
    await input.request(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
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
