import assert from "node:assert/strict";
import test from "node:test";
import { pollJobUntilTerminal, type TestJob } from "./client.js";

test("polling emits each new log once and returns terminal Test status", async () => {
  const states: TestJob[] = [
    { id: "job-1", action: "map:test", status: "running", logs: ["queued"] },
    { id: "job-1", action: "map:test", status: "running", logs: ["queued", "running"] },
    { id: "job-1", action: "map:test", status: "ok", logs: ["queued", "running", "done"] },
  ];
  const logs: string[] = [];
  const result = await pollJobUntilTerminal({
    jobId: "job-1",
    load: async () => states.shift()!,
    onLog: (line) => logs.push(line),
    wait: async () => undefined,
  });

  assert.deepEqual(logs, ["queued", "running", "done"]);
  assert.deepEqual(result, { ok: true, error: undefined, result: undefined, status: "ok" });
});

test("polling bounds an unattended non-terminal Test", async () => {
  await assert.rejects(
    pollJobUntilTerminal({
      jobId: "job-stuck",
      load: async () => ({ id: "job-stuck", action: "map:test", status: "paused" }),
      timeoutMs: 0,
      wait: async () => undefined,
    }),
    /Timed out waiting for Test job job-stuck after 0ms/,
  );
});
