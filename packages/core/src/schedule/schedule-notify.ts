import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { publish } from "../events.js";
import { redactText } from "../redaction.js";
import { join } from "node:path";
import { findWorkspaceRoot } from "../workspace/workspace-root.js";

export type ScheduleNotification = {
  at: number;
  scheduleId: string;
  kind: "started" | "failed";
  detail: string;
  combineId?: string;
  recipeId?: string;
  delivery?: {
    status: "pending" | "delivered" | "failed" | "disabled";
    attemptedAt?: number;
    error?: string;
  };
};

const MAX_NOTIFICATIONS = 200;

function notificationsFile(): string {
  return join(findWorkspaceRoot(), ".relay", "notifications.json");
}

async function readNotifications(file: string): Promise<ScheduleNotification[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(raw) ? (raw as ScheduleNotification[]) : [];
  } catch {
    return [];
  }
}

async function postWebhook(
  item: ScheduleNotification,
  timeoutMs: number,
): Promise<NonNullable<ScheduleNotification["delivery"]>> {
  const url = process.env.RELAY_NOTIFY_WEBHOOK?.trim();
  if (!url) return { status: "disabled" };
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "relay-plan-schedule",
        ...item,
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
    return { status: "delivered", attemptedAt: Date.now() };
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error));
    publish({
      type: "error",
      at: Date.now(),
      where: "schedule.notification.delivery",
      message: redactText(
        `Schedule ${item.scheduleId} webhook failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    });
    return { status: "failed", attemptedAt: Date.now(), error: message };
  }
}

const writes = new Map<string, Promise<void>>();

export async function recordScheduleNotification(
  item: ScheduleNotification,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const file = notificationsFile();
  await persistNotification(file, { ...item, delivery: { status: "pending" } });
  const delivery = await postWebhook(item, options.timeoutMs ?? 5_000);
  await persistNotification(file, { ...item, delivery });
}

async function persistNotification(file: string, item: ScheduleNotification): Promise<void> {
  const write = (writes.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const previous = await readNotifications(file);
      const next = [
        ...previous.filter(
          (entry) =>
            entry.scheduleId !== item.scheduleId ||
            entry.at !== item.at ||
            entry.kind !== item.kind,
        ),
        item,
      ].slice(-MAX_NOTIFICATIONS);
      await mkdir(join(file, ".."), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), { flag: "wx", mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  writes.set(file, write);
  try {
    await write;
  } finally {
    if (writes.get(file) === write) writes.delete(file);
  }
}
