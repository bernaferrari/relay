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
