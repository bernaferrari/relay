import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readRelayPanel } from "./panel-state.js";
import type { OperationInvoker } from "./server.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sNQAAAAASUVORK5CYII=",
  "base64",
);
const digest = createHash("sha256").update(png).digest("hex");
const signal = new AbortController().signal;

function fixture(tampered = false) {
  const invocations: string[] = [];
  const invoker: OperationInvoker = {
    async invoke(id) {
      invocations.push(id);
      if (id === "app-map.list")
        return { appMaps: [{ id: "app-1", name: "Checkout", secret: "private" }] };
      if (id === "app-map.get")
        return { appMap: { tests: { test: { name: "Open checkout", steps: [{}] } } } };
      if (id === "run.list")
        return {
          runs: [
            {
              id: "run-1",
              action: "Open checkout",
              status: "passed",
              dir: "/private/run",
              token: "private",
            },
          ],
        };
      if (id === "run.get")
        return { run: { id: "run-1", action: "Open checkout", status: "passed" } };
      if (id === "run.walkthrough-pack.get")
        return {
          pack: {
            frames: [
              {
                runId: "run-1",
                framePath: "/private/frame.png",
                imageSha256: tampered ? "wrong" : digest,
                content: png.toString("base64"),
              },
            ],
          },
        };
      throw new Error(`Unexpected mutation ${id}`);
    },
  };
  return { invoker, invocations };
}

test("read-only panel reads canonical state and returns only scoped presentation fields", async () => {
  const { invoker, invocations } = fixture();
  const result = await readRelayPanel(invoker, { projectId: "project" }, {}, signal);
  assert.equal(result.state.readOnly, true);
  assert.equal(result.state.appMapId, "app-1");
  assert.equal(result.state.tests[0]?.stepCount, 1);
  assert.deepEqual(invocations, ["app-map.list", "app-map.get", "run.list"]);
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/);
});

test("panel screenshot is retained, identity-matched and hash checked", async () => {
  const { invoker, invocations } = fixture();
  const result = await readRelayPanel(
    invoker,
    { projectId: "project" },
    { runId: "run-1", frameIndex: 0 },
    signal,
  );
  assert.equal(result.frame?.imageSha256, digest);
  assert.equal(result.frame?.runId, "run-1");
  assert.equal(result.frame?.count, 1);
  assert.equal(invocations.includes("target.screenshot.capture"), false);
  assert.equal(invocations.includes("run.review"), false);
  const invalid = await readRelayPanel(
    fixture(true).invoker,
    { projectId: "project" },
    { runId: "run-1", frameIndex: 0 },
    signal,
  );
  assert.equal(invalid.frame, undefined);
  assert.match(invalid.state.issues.join(" "), /integrity/);
});

test("panel reports inaccessible state without leaking a transport credential", async () => {
  const result = await readRelayPanel(
    {
      async invoke() {
        throw new Error("Bearer private-token /Users/private");
      },
    },
    { projectId: "project" },
    {},
    signal,
  );
  assert.equal(result.state.issues.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-token|\/Users/);
});

test("panel rejects mismatched Run identity before reading any screenshot", async () => {
  const { invoker, invocations } = fixture();
  const result = await readRelayPanel(
    invoker,
    { projectId: "project" },
    { runId: "different-run", frameIndex: 0 },
    signal,
  );
  assert.equal(result.state.selectedRun, undefined);
  assert.equal(result.frame, undefined);
  assert.equal(invocations.includes("run.walkthrough-pack.get"), false);
  assert.match(result.state.issues.join(" "), /unavailable in the current project/);
});

test("panel bounds the image response and does not forward oversized artifacts", async () => {
  const original = fixture().invoker;
  const result = await readRelayPanel(
    {
      async invoke(id, input, context) {
        if (id === "run.walkthrough-pack.get")
          return {
            pack: {
              frames: [{ runId: "run-1", content: "A".repeat(2_800_001), imageSha256: digest }],
            },
          };
        return original.invoke(id, input, context);
      },
    },
    { projectId: "project" },
    { runId: "run-1", frameIndex: 0 },
    signal,
  );
  assert.equal(result.frame, undefined);
  assert.match(result.state.issues.join(" "), /too large/);
});
