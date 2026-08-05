import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetProfile } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

export type LocalSchedule = {
  id: string;
  recipeId: string;
  /** The exact local target frozen when this schedule was created. */
  targetKind: "device" | "browser";
  targetId: string;
  platform: "android" | "ios" | "browser";
  intervalMinutes: number;
  repetitions: number;
  enabled: boolean;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lastRunAt?: number;
};

/**
 * Resolve a schedule against observations taken immediately before it starts.
 *
 * Schedules retain stable target identity, while each execution freezes the
 * current target facts onto its report. That keeps run evidence accurate when a
 * device, app build, or browser viewport changes after scheduling.
 */
export function resolveScheduledTargetProfile(
  schedule: Pick<LocalSchedule, "targetId" | "targetKind">,
  profiles: TargetProfile[],
): TargetProfile | undefined {
  const source = schedule.targetKind === "browser" ? "browser" : "device";
  return profiles.find(
    (profile) => profile.targetId === schedule.targetId && profile.source === source,
  );
}

function scheduleFile(): string {
  return join(findWorkspaceRoot(), ".relay", "schedules.json");
}

async function readAllSchedules(): Promise<LocalSchedule[]> {
  try {
    const value = JSON.parse(await readFile(scheduleFile(), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    // Local schedule files existed before browser targets. Read their
    // deviceSerial shape once and always write the target-neutral shape back.
    return value.flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Partial<LocalSchedule> & { deviceSerial?: unknown };
      const targetKind = item.targetKind === "browser" ? "browser" : "device";
      const targetId =
        typeof item.targetId === "string" && item.targetId.trim()
          ? item.targetId
          : typeof item.deviceSerial === "string" && item.deviceSerial.trim()
            ? item.deviceSerial
            : "";
      if (!targetId || typeof item.id !== "string" || typeof item.recipeId !== "string") return [];
      const platform =
        targetKind === "browser" ? "browser" : item.platform === "ios" ? "ios" : "android";
      return [
        {
          id: item.id,
          recipeId: item.recipeId,
          targetKind,
          targetId,
          platform,
          intervalMinutes: Number(item.intervalMinutes) || 1_440,
          repetitions: Number(item.repetitions) || 1,
          enabled: item.enabled !== false,
          projectId:
            typeof item.projectId === "string" && item.projectId ? item.projectId : "default",
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now(),
          nextRunAt: Number(item.nextRunAt) || Date.now(),
          ...(typeof item.lastRunAt === "number" ? { lastRunAt: item.lastRunAt } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

export async function listSchedules(filter?: { projectId?: string }): Promise<LocalSchedule[]> {
  const schedules = await readAllSchedules();
  if (!filter?.projectId) return schedules;
  return schedules.filter((item) => item.projectId === filter.projectId);
}

async function writeSchedules(schedules: LocalSchedule[]): Promise<void> {
  await mkdir(join(findWorkspaceRoot(), ".relay"), { recursive: true });
  await writeFile(scheduleFile(), JSON.stringify(schedules, null, 2), "utf8");
}

export async function saveSchedule(
  input: Pick<
    LocalSchedule,
    "recipeId" | "targetKind" | "targetId" | "platform" | "intervalMinutes"
  > &
    Partial<Pick<LocalSchedule, "id" | "repetitions" | "enabled" | "projectId">>,
): Promise<LocalSchedule> {
  if (!input.recipeId.trim()) throw new Error("recipeId is required");
  if (!input.targetId.trim()) throw new Error("targetId is required");
  if (input.targetKind !== "device" && input.targetKind !== "browser") {
    throw new Error('targetKind must be "device" or "browser"');
  }
  if (input.targetKind === "browser" && input.platform !== "browser") {
    throw new Error("browser schedules require platform browser");
  }
  if (input.targetKind === "device" && input.platform !== "android" && input.platform !== "ios") {
    throw new Error("device schedules require platform android or ios");
  }
  if (
    !Number.isFinite(input.intervalMinutes) ||
    input.intervalMinutes < 1 ||
    input.intervalMinutes > 43_200
  )
    throw new Error("intervalMinutes must be from 1 to 43200");
  const schedules = await readAllSchedules();
  const existing = input.id
    ? schedules.find((item) => item.id === input.id)
    : schedules.find(
        (item) =>
          item.recipeId === input.recipeId &&
          item.targetKind === input.targetKind &&
          item.targetId === input.targetId,
      );
  const now = Date.now();
  const schedule: LocalSchedule = {
    id: existing?.id ?? randomUUID(),
    recipeId: input.recipeId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    platform: input.platform,
    intervalMinutes: Math.floor(input.intervalMinutes),
    repetitions: Math.max(1, Math.min(Math.floor(input.repetitions ?? 1), 20)),
    enabled: input.enabled ?? true,
    projectId: input.projectId?.trim() || "default",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextRunAt: existing?.nextRunAt ?? now + input.intervalMinutes * 60_000,
    lastRunAt: existing?.lastRunAt,
  };
  await writeSchedules([...schedules.filter((item) => item.id !== schedule.id), schedule]);
  return schedule;
}

export async function deleteSchedule(
  id: string,
  filter?: { projectId?: string },
): Promise<boolean> {
  const schedules = await readAllSchedules();
  const current = schedules.find((item) => item.id === id);
  if (!current) return false;
  if (filter?.projectId && current.projectId !== filter.projectId) return false;
  await writeSchedules(schedules.filter((item) => item.id !== id));
  return true;
}

export async function markScheduleRun(id: string, at = Date.now()): Promise<void> {
  const schedules = await readAllSchedules();
  const current = schedules.find((item) => item.id === id);
  if (!current) return;
  await writeSchedules([
    ...schedules.filter((item) => item.id !== id),
    {
      ...current,
      lastRunAt: at,
      nextRunAt: at + current.intervalMinutes * 60_000,
      updatedAt: at,
    },
  ]);
}
