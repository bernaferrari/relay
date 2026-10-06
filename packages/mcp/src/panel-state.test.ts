import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { RunPanelManifest } from "@relay/protocol";
import { readRelayPanel, panelRunPresentation } from "./panel-state.js";
import { PanelRequestGate } from "../panel/load-state.js";
import type { OperationInvoker } from "./server.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sNQAAAAASUVORK5CYII=",
  "base64",
);
const digest = createHash("sha256").update(png).digest("hex");
const signal = new AbortController().signal;
function fixture(
  input: { frameCount?: number; tampered?: boolean; missing?: boolean; oversized?: boolean } = {},
) {
  const totalCount = input.frameCount ?? 1;
  const invocations: { id: string; args: Record<string, unknown> }[] = [];
  const downloads: { path: string; maxBytes?: number }[] = [];
  const manifest: RunPanelManifest = {
    schemaVersion: 1,
    run: {
      id: "run-1",
      name: "Open checkout",
      status: "ok",
      outcome: "passed",
      attempts: 1,
      history: [],
      historyCount: 0,
    },
    coverage: {
      planned: totalCount,
      captured: input.missing ? 0 : totalCount,
      missing: input.missing ? totalCount : 0,
      blocked: 0,
      pending: input.missing ? 0 : totalCount,
      accepted: 0,
      issue: 0,
      needMoreEvidence: 0,
    },
    checks: {
      passed: 1,
      failed: 0,
      needsReview: 0,
      totalCount: 1,
      items: [{ title: "Save exists", status: "passed" }],
      truncated: false,
    },
    frames: {
      offset: 0,
      totalCount,
      truncated: false,
      items: Array.from({ length: totalCount }, (_, index) => ({
        index,
        captureId: `capture-${index}`,
        caption: `Screenshot ${index + 1}`,
        status: input.missing ? "missing" : "pending",
        blocked: false,
        ...(input.missing
          ? {}
          : { file: `${index}.png`, imageSha256: input.tampered ? "a".repeat(64) : digest }),
        configuration: { account: "member", browser: "chromium", viewport: "1280x800" },
      })),
    },
  };
  const invoker: OperationInvoker = {
    async invoke(id, args) {
      invocations.push({ id, args });
      if (id === "app-map.list")
        return { appMaps: [{ id: "app-1", name: "Checkout", secret: "private" }] };
      if (id === "app-map.get")
        return { appMap: { tests: { test: { name: "Open checkout", steps: [{}] } } } };
      if (id === "run.list")
        return {
          runs: [
            {
              ...manifest.run,
              action: "Open checkout",
              captureSummary: manifest.coverage,
              dir: "/private/run",
              token: "private",
            },
          ],
        };
      if (id === "run.panel-manifest.get") {
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 40);
        return {
          manifest: {
            ...manifest,
            frames: {
              ...manifest.frames,
              offset,
              items: manifest.frames.items.slice(offset, offset + limit),
              truncated: offset > 0 || offset + limit < totalCount,
              ...(offset + limit < totalCount ? { nextOffset: offset + limit } : {}),
            },
          },
        };
      }
      throw new Error(`Unexpected operation ${id}`);
    },
    async binaryResource(path, _init, maxBytes) {
      downloads.push({ path, maxBytes });
      return {
        bytes: input.oversized ? Buffer.alloc(2_000_001) : png,
        headers: new Headers({ "content-type": "image/png" }),
      };
    },
  };
  return { invoker, invocations, downloads, manifest };
}

test("read-only catalog returns scoped presentation without images or local paths", async () => {
  const f = fixture();
  const result = await readRelayPanel(f.invoker, { projectId: "project" }, {}, signal);
  assert.equal(result.state.readOnly, true);
  assert.equal(result.state.appMapId, "app-1");
  assert.equal((result.state.tests as { stepCount: number }[])[0]?.stepCount, 1);
  assert.deepEqual(
    f.invocations.map((v) => v.id),
    ["app-map.list", "app-map.get", "run.list"],
  );
  assert.equal(f.downloads.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/);
});

test("completed execution with pending screenshots keeps checks and human acceptance independent", async () => {
  const f = fixture();
  const result = await readRelayPanel(
    f.invoker,
    { projectId: "project" },
    { runId: "run-1", frameIndex: 0, view: "run" },
    signal,
  );
  const selected = result.state.selectedRun as {
    outcome: string;
    presentation: ReturnType<typeof panelRunPresentation>;
    coverageLine: string;
    checks: { passed: number };
  };
  assert.equal(selected.outcome, "passed");
  assert.equal(selected.presentation.label, "Completed · awaiting review");
  assert.equal(selected.presentation.outcome, "Checks passed");
  assert.equal(selected.checks.passed, 1);
  assert.match(selected.coverageLine, /1 planned.*1 screenshot awaiting review/);
  assert.doesNotMatch(selected.presentation.label, /Passed/);
  assert.equal(result.frame?.imageSha256, digest);
  assert.deepEqual(
    f.invocations.map((v) => v.id),
    ["run.panel-manifest.get"],
  );
  assert.equal(f.downloads[0]?.path, "/runs/run-1/frames/0.png?maxBytes=2000000");
});

test("healed execution preserves preceding failure, attempts and exact revision", async () => {
  const f = fixture();
  Object.assign(f.manifest.run, {
    status: "healed",
    attempts: 2,
    retryOf: "failed-run",
    repair: "Recovered after failure: Save was hidden",
    sourceRevision: { vcs: "git", sha: "a".repeat(40) },
    history: [
      { title: "Save missing", status: "error" },
      { title: "Saved", status: "healed" },
    ],
    historyCount: 2,
  });
  const result = await readRelayPanel(
    f.invoker,
    { projectId: "project" },
    { runId: "run-1", view: "run" },
    signal,
  );
  const run = result.state.selectedRun as typeof f.manifest.run & {
    presentation: { label: string };
  };
  assert.equal(run.sourceRevision?.sha, "a".repeat(40));
  assert.equal(run.attempts, 2);
  assert.equal(run.retryOf, "failed-run");
  assert.equal(run.history[0]?.status, "error");
  assert.match(run.repair ?? "", /Save was hidden/);
  assert.match(run.presentation.label, /Completed after repair.*awaiting review/);
});

test("thirty-frame navigation uses only one bounded manifest entry and one image per frame", async () => {
  const f = fixture({ frameCount: 30 });
  for (let frameIndex = 0; frameIndex < 30; frameIndex++) {
    const result = await readRelayPanel(
      f.invoker,
      { projectId: "project" },
      { appMapId: "app-1", runId: "run-1", frameIndex, view: "frame" },
      signal,
    );
    assert.equal(result.frame?.index, frameIndex);
    assert.equal(result.frame?.count, 30);
    assert.ok(Buffer.byteLength(JSON.stringify(result.state)) < 5000);
    assert.equal((result.state.manifest as { items: unknown[] }).items.length, 1);
  }
  assert.equal(f.invocations.length, 30);
  assert.ok(f.invocations.every((v) => v.id === "run.panel-manifest.get" && v.args.limit === 1));
  assert.equal(f.downloads.length, 30);
  assert.ok(f.downloads.every((v) => v.maxBytes === 2_000_000));
});

test("missing, blocked, oversized and corrupt frames never substitute another image", async () => {
  for (const input of [{ missing: true }, { oversized: true }, { tampered: true }]) {
    const f = fixture(input);
    const result = await readRelayPanel(
      f.invoker,
      { projectId: "project" },
      { runId: "run-1", frameIndex: 0, view: "frame" },
      signal,
    );
    assert.equal(result.frame, undefined);
    assert.match((result.state.issues as string[]).join(" "), /missing|display limit|integrity/);
    assert.equal(f.downloads.length, input.missing ? 0 : 1);
  }
  const blocked = fixture({ missing: true });
  blocked.manifest.frames.items[0]!.blocked = true;
  Object.assign(blocked.manifest.coverage, { blocked: 1, missing: 0 });
  const result = await readRelayPanel(
    blocked.invoker,
    { projectId: "project" },
    { runId: "run-1", frameIndex: 0, view: "run" },
    signal,
  );
  assert.equal(result.frame, undefined);
  assert.match((result.state.issues as string[]).join(" "), /blocked/);
  assert.match(
    (result.state.selectedRun as { coverageLine: string }).coverageLine,
    /1 blocked.*0 missing/,
  );
  assert.equal(blocked.downloads.length, 0);
});

test("panel rejects another Run identity before any artifact read", async () => {
  const f = fixture();
  const result = await readRelayPanel(
    f.invoker,
    { projectId: "project" },
    { runId: "other-run", frameIndex: 0, view: "run" },
    signal,
  );
  assert.equal(result.state.selectedRun, undefined);
  assert.equal(result.frame, undefined);
  assert.equal(f.downloads.length, 0);
  assert.match((result.state.issues as string[]).join(" "), /unavailable in the current project/);
});

test("panel reports inaccessible state without leaking transport credentials", async () => {
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
  assert.equal((result.state.issues as string[]).length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private-token|\/Users/);
});

test("a late old-Run response and a mismatched image cannot paint the current selection", async () => {
  const gate = new PanelRequestGate();
  let finishOld!: (value: Record<string, unknown>) => void;
  const old = new Promise<Record<string, unknown>>((resolve) => {
    finishOld = resolve;
  });
  const painted: string[] = [];
  const first = gate.begin({ appMapId: "app-1", runId: "old-run", frameIndex: 0 }, "first");
  const oldLoad = old.then((state) => {
    if (gate.current(first) && gate.accepts(state)) painted.push(String(state.runId));
  });
  gate.begin({ appMapId: "app-1", runId: "new-run", frameIndex: 0 }, "second");
  const current = { appMapId: "app-1", runId: "new-run", frameIndex: 0, requestId: "second" };
  assert.equal(gate.accepts(current, { runId: "old-run", index: 0 }), false);
  assert.equal(gate.accepts(current, { runId: "new-run", index: 1 }), false);
  if (gate.accepts(current)) painted.push(String(current.runId));
  finishOld({ appMapId: "app-1", runId: "old-run", frameIndex: 0, requestId: "first" });
  await oldLoad;
  assert.deepEqual(painted, ["new-run"]);
});
