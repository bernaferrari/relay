import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordScheduleNotification } from "./schedule-notify.js";

test("Plan schedule notices persist locally and POST the webhook", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-schedule-notify-"));
  const cwd = process.cwd();
  const previous = process.env.RELAY_NOTIFY_WEBHOOK;
  const posted: unknown[] = [];
  process.chdir(root);
  await writeFile(join(root, "pnpm-lock.yaml"), "");
  process.env.RELAY_NOTIFY_WEBHOOK = "https://example.test/notify";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    posted.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    await recordScheduleNotification({
      at: 1,
      scheduleId: "sched-1",
      kind: "started",
      detail: "Plan started",
      combineId: "grok-web-daily",
    });
    const stored = JSON.parse(await readFile(join(root, ".relay", "notifications.json"), "utf8"));
    assert.equal(stored[0]?.combineId, "grok-web-daily");
    assert.equal(
      posted[0] && typeof posted[0] === "object" && posted[0] !== null
        ? (posted[0] as { source?: string }).source
        : undefined,
      "relay-plan-schedule",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.RELAY_NOTIFY_WEBHOOK;
    else process.env.RELAY_NOTIFY_WEBHOOK = previous;
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("a webhook that never responds times out and reports delivery failure", async () => {
  const { createServer } = await import("node:http");
  const { subscribe } = await import("./events.js");
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = await mkdtemp(join(tmpdir(), "relay-schedule-timeout-"));
  const cwd = process.cwd();
  const previous = process.env.RELAY_NOTIFY_WEBHOOK;
  process.chdir(root);
  process.env.RELAY_NOTIFY_WEBHOOK = `http://127.0.0.1:${address.port}/notify`;
  const failures: string[] = [];
  const unsubscribe = subscribe(({ payload: event }) => {
    if (event.type === "error" && event.where === "schedule.notification.delivery")
      failures.push(event.message);
  });
  try {
    await recordScheduleNotification(
      { at: 1, scheduleId: "timeout", kind: "started", detail: "Started" },
      { timeoutMs: 25 },
    );
    assert.equal(failures.length, 1);
    const saved = JSON.parse(await readFile(join(root, ".relay", "notifications.json"), "utf8"));
    assert.equal(saved[0].scheduleId, "timeout");
    assert.equal(saved[0].delivery.status, "failed");
  } finally {
    unsubscribe();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined) delete process.env.RELAY_NOTIFY_WEBHOOK;
    else process.env.RELAY_NOTIFY_WEBHOOK = previous;
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent notification writes preserve every notice", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-schedule-notices-"));
  const cwd = process.cwd();
  const previous = process.env.RELAY_NOTIFY_WEBHOOK;
  delete process.env.RELAY_NOTIFY_WEBHOOK;
  process.chdir(root);
  try {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        recordScheduleNotification({
          at: index,
          scheduleId: `schedule-${index}`,
          kind: "started",
          detail: "Started",
        }),
      ),
    );
    const saved = JSON.parse(await readFile(join(root, ".relay", "notifications.json"), "utf8"));
    assert.equal(new Set(saved.map((item: { scheduleId: string }) => item.scheduleId)).size, 12);
  } finally {
    if (previous !== undefined) process.env.RELAY_NOTIFY_WEBHOOK = previous;
    process.chdir(cwd);
    await rm(root, { recursive: true, force: true });
  }
});
