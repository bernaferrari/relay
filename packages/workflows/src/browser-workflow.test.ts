import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { createBrowserWorkflow, type BrowserInspection } from "./browser-workflow.js";
import { createScriptedRelayClient } from "./testing.js";
const frame = {
  sessionId: "session",
  pageId: "page",
  sequence: 1,
  pageUrl: "https://example.com/",
  visualFingerprint: "pixels",
  capturedAt: 1,
  mime: "image/jpeg" as const,
  base64: "AA==",
  bytes: 1,
  width: 800,
  height: 600,
};
const session = {
  schemaVersion: 1,
  sessionId: "session",
  targetId: "web",
  status: "streaming",
  ownership: "controlled",
  sequence: 1,
  activePageId: "page",
  pages: [],
  profile: compileBrowserEnvironment(),
  startedAt: 1,
};
const overlay = {
  schemaVersion: 1 as const,
  sessionId: "session",
  pageId: "page",
  sequence: 1,
  visualFingerprint: "pixels",
  capturedAt: 1,
  candidates: [],
  truncated: false,
};
const current: BrowserInspection = { frame, overlay };
test("inspection refreshes only stale reads", async () => {
  const scripted = createScriptedRelayClient([
    { id: "target.browser-device.frame", output: { session, frame } },
    { id: "target.browser-device.inspect", error: { body: { code: "BROWSER_STALE_INPUT" } } },
    { id: "target.browser-device.frame", output: { session, frame: { ...frame, sequence: 2 } } },
    {
      id: "target.browser-device.inspect",
      output: { overlay: { ...overlay, sequence: 2 } },
      checkInput(input) {
        assert.equal((input as { expectedSequence: number }).expectedSequence, 2);
      },
    },
  ]);
  assert.equal((await createBrowserWorkflow(scripted.client, "web").inspect()).frame.sequence, 2);
  assert.equal(scripted.remaining(), 0);
});
test("failed actions are not replayed, and follow-up read failure reports completed action", async () => {
  const action = {
    sessionId: "session",
    pageId: "page",
    expectedSequence: 1,
    kind: "navigate" as const,
    url: "https://example.com/plans",
  };
  const failed = createScriptedRelayClient([
    { id: "target.browser-device.control", error: new Error("stale") },
  ]);
  await assert.rejects(createBrowserWorkflow(failed.client, "web").act(current, action), /stale/);
  assert.equal(failed.invocations.length, 1);
  const completed = createScriptedRelayClient([
    { id: "target.browser-device.control", output: { ok: true, session } },
    { id: "target.browser-device.frame", error: new Error("unavailable") },
  ]);
  await assert.rejects(
    createBrowserWorkflow(completed.client, "web").act(current, action),
    /action completed.*do not repeat/,
  );
  assert.equal(
    completed.invocations.filter((v) => v.id === "target.browser-device.control").length,
    1,
  );
});
