import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findWorkspaceRoot } from "./workspace-root.js";

export type ScheduleNotification = {
  at: number;
  scheduleId: string;
  kind: "started" | "failed";
  detail: string;
  combineId?: string;
  recipeId?: string;
};

const MAX_NOTIFICATIONS = 200;

function notificationsFile(): string {
  return join(findWorkspaceRoot(), ".relay", "notifications.json");
}

async function readNotifications(): Promise<ScheduleNotification[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(notificationsFile(), "utf8"));
    return Array.isArray(raw) ? (raw as ScheduleNotification[]) : [];
  } catch {
    return [];
  }
}

async function postWebhook(item: ScheduleNotification): Promise<void> {
  const url = process.env.RELAY_NOTIFY_WEBHOOK?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "relay-plan-schedule",
        ...item,
      }),
    });
  } catch {
    // Unattended notify must not fail the scheduled admission.
  }
}

export async function recordScheduleNotification(item: ScheduleNotification): Promise<void> {
  const next = [...(await readNotifications()), item].slice(-MAX_NOTIFICATIONS);
  await mkdir(join(findWorkspaceRoot(), ".relay"), { recursive: true });
  await writeFile(notificationsFile(), JSON.stringify(next, null, 2), "utf8");
  await postWebhook(item);
}
