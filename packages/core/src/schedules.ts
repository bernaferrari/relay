import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetProfile } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import { computeScheduleNextRunAt, assertIanaTimeZone } from "./schedule-next-run.js";
import type { CombineExecutionAccount } from "./combine-campaign-case-identity.js";

export type ScheduledPlanProfileTarget = {
  profileId: string;
  targetProfileId?: string;
  engine?: "chromium" | "firefox" | "webkit";
  account?: CombineExecutionAccount;
  target: {
    targetKind?: "device" | "browser";
    serial?: string;
    platform?: "android" | "ios" | "browser";
    browserTargetId?: string;
  };
};

export type LocalSchedule = {
  id: string;
  recipeId: string;
  combineId?: string;
  appMapId?: string;
  hour?: number;
  timezone?: string;
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
  /** Last scheduler admission failure. Kept on the schedule so unattended
   * failures remain visible through the existing list API. */
  lastFailureAt?: number;
  lastFailure?: string;
  /** Frozen Plan columns. Daily runs bind these accounts instead of inferring. */
  profileTargets?: ScheduledPlanProfileTarget[];
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

function optionalTrimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseScheduledAccount(raw: unknown): CombineExecutionAccount | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;
  if (item.kind === "signed-out" && item.attested === true) {
    return { kind: "signed-out", attested: true };
  }
  const accountId = optionalTrimmed(item.accountId);
  const accountRevision = optionalTrimmed(item.accountRevision);
  if (item.kind !== "fixture" || !accountId || !accountRevision) return undefined;
  const reference = optionalTrimmed(item.reference);
  return {
    kind: "fixture",
    accountId,
    accountRevision,
    ...(reference ? { reference } : {}),
  };
}

function parseScheduledProfileTarget(raw: unknown): ScheduledPlanProfileTarget | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const item = raw as Record<string, unknown>;
  const profileId = optionalTrimmed(item.profileId);
  const target = item.target;
  if (!profileId || !target || typeof target !== "object" || Array.isArray(target))
    return undefined;
  const record = target as Record<string, unknown>;
  const targetKind =
    record.targetKind === "browser" || record.targetKind === "device"
      ? record.targetKind
      : undefined;
  const platform =
    record.platform === "android" || record.platform === "ios" || record.platform === "browser"
      ? record.platform
      : undefined;
  const engine =
    item.engine === "chromium" || item.engine === "firefox" || item.engine === "webkit"
      ? item.engine
      : undefined;
  const account = parseScheduledAccount(item.account);
  const targetProfileId = optionalTrimmed(item.targetProfileId);
  return {
    profileId,
    target: {
      ...(targetKind ? { targetKind } : {}),
      ...(optionalTrimmed(record.serial) ? { serial: optionalTrimmed(record.serial) } : {}),
      ...(platform ? { platform } : {}),
      ...(optionalTrimmed(record.browserTargetId)
        ? { browserTargetId: optionalTrimmed(record.browserTargetId) }
        : {}),
    },
    ...(targetProfileId ? { targetProfileId } : {}),
    ...(engine ? { engine } : {}),
    ...(account ? { account } : {}),
  };
}

function parseScheduledProfileTargets(raw: unknown): ScheduledPlanProfileTarget[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return undefined;
  const parsed = raw.flatMap((item) => {
    const target = parseScheduledProfileTarget(item);
    return target ? [target] : [];
  });
  return parsed.length === raw.length ? parsed : undefined;
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
      const combineId = optionalTrimmed(item.combineId);
      const appMapId = optionalTrimmed(item.appMapId);
      const timezone = optionalTrimmed(item.timezone);
      const profileTargets = parseScheduledProfileTargets(item.profileTargets);
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
          ...(combineId ? { combineId } : {}),
          ...(appMapId ? { appMapId } : {}),
          ...(typeof item.hour === "number" &&
          Number.isInteger(item.hour) &&
          item.hour >= 0 &&
          item.hour <= 23
            ? { hour: item.hour }
            : {}),
          ...(timezone ? { timezone } : {}),
          ...(typeof item.lastRunAt === "number" ? { lastRunAt: item.lastRunAt } : {}),
          ...(typeof item.lastFailureAt === "number" ? { lastFailureAt: item.lastFailureAt } : {}),
          ...(typeof item.lastFailure === "string" && item.lastFailure.trim()
            ? { lastFailure: item.lastFailure }
            : {}),
          ...(profileTargets ? { profileTargets } : {}),
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
  input: Pick<LocalSchedule, "targetKind" | "targetId" | "platform" | "intervalMinutes"> &
    Partial<
      Pick<
        LocalSchedule,
        | "id"
        | "recipeId"
        | "combineId"
        | "appMapId"
        | "hour"
        | "timezone"
        | "profileTargets"
        | "repetitions"
        | "enabled"
        | "projectId"
      >
    >,
): Promise<LocalSchedule> {
  const recipeId = input.recipeId?.trim() ?? "";
  const combineId = input.combineId?.trim() ?? "";
  if (!recipeId && !combineId) throw new Error("recipeId or combineId is required");
  if (combineId && !input.appMapId?.trim()) throw new Error("A Plan schedule requires appMapId");
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
  if (
    input.hour !== undefined &&
    (input.hour < 0 || input.hour > 23 || !Number.isInteger(input.hour))
  ) {
    throw new Error("hour must be from 0 to 23");
  }
  if (input.timezone) assertIanaTimeZone(input.timezone);
  if (input.profileTargets && input.profileTargets.length > 64) {
    throw new Error("A Plan schedule can freeze at most 64 columns");
  }
  const schedules = await readAllSchedules();
  const existing = input.id
    ? schedules.find((item) => item.id === input.id)
    : schedules.find(
        (item) =>
          (combineId ? item.combineId === combineId : item.recipeId === recipeId) &&
          item.targetKind === input.targetKind &&
          item.targetId === input.targetId,
      );
  const now = Date.now();
  const hour = input.hour;
  const timezone = input.timezone?.trim() || undefined;
  const schedule: LocalSchedule = {
    id: existing?.id ?? randomUUID(),
    recipeId,
    ...(combineId ? { combineId, appMapId: input.appMapId!.trim() } : {}),
    ...(hour !== undefined ? { hour } : {}),
    ...(timezone ? { timezone } : {}),
    ...(input.profileTargets?.length
      ? { profileTargets: structuredClone(input.profileTargets) }
      : {}),
    targetKind: input.targetKind,
    targetId: input.targetId,
    platform: input.platform,
    intervalMinutes: Math.floor(input.intervalMinutes),
    repetitions: Math.max(1, Math.min(Math.floor(input.repetitions ?? 1), 20)),
    enabled: input.enabled ?? true,
    projectId: input.projectId?.trim() || "default",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nextRunAt:
      existing?.nextRunAt ?? computeScheduleNextRunAt(now, input.intervalMinutes, hour, timezone),
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
  const { lastFailure: _lastFailure, lastFailureAt: _lastFailureAt, ...cleared } = current;
  await writeSchedules([
    ...schedules.filter((item) => item.id !== id),
    {
      ...cleared,
      lastRunAt: at,
      nextRunAt: computeScheduleNextRunAt(
        at,
        current.intervalMinutes,
        current.hour,
        current.timezone,
      ),
      updatedAt: at,
    },
  ]);
}

/** Record a failed occurrence and advance its deadline exactly once. A broken
 * schedule therefore stays visible without being retried every scheduler poll. */
export async function markScheduleFailure(
  id: string,
  error: string,
  at = Date.now(),
): Promise<void> {
  const schedules = await readAllSchedules();
  const current = schedules.find((item) => item.id === id);
  if (!current) return;
  await writeSchedules([
    ...schedules.filter((item) => item.id !== id),
    {
      ...current,
      nextRunAt: computeScheduleNextRunAt(
        at,
        current.intervalMinutes,
        current.hour,
        current.timezone,
      ),
      lastFailureAt: at,
      lastFailure: error.trim() || "Scheduled run failed",
      updatedAt: at,
    },
  ]);
}
