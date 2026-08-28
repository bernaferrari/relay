import assert from "node:assert/strict";
import test from "node:test";
import { connectLegacyStudioShellEvents } from "./studio-shell-event-adapter";

test("legacy shell events are isolated behind typed callbacks", () => {
  const target = new EventTarget();
  const calls: unknown[] = [];
  const disconnect = connectLegacyStudioShellEvents(target as Window, {
    onOpenSettings: (section) => calls.push(["settings", section]),
    onOpenRun: (id) => calls.push(["run", id]),
  });

  target.dispatchEvent(new CustomEvent("relay:open-settings", { detail: { section: "targets" } }));
  target.dispatchEvent(new CustomEvent("relay:open-run-history", { detail: { jobId: "job" } }));
  assert.deepEqual(calls, [
    ["settings", "targets"],
    ["run", "job"],
  ]);
  disconnect();
  target.dispatchEvent(new CustomEvent("relay:open-run-history", { detail: { jobId: "late" } }));
  assert.equal(calls.length, 2);
});
