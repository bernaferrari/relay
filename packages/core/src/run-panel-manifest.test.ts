import assert from "node:assert/strict";
import test from "node:test";
import { runPanelManifestSchema } from "@relay/protocol";
import { buildRunPanelManifest } from "./run-panel-manifest.js";
import type { PersistedRun } from "./runs.js";

const hash = "a".repeat(64);
const run = (input: Partial<PersistedRun> = {}): PersistedRun =>
  ({
    schemaVersion: 5,
    id: "run-1",
    title: "Checkout",
    action: "checkout",
    status: "ok",
    outcome: "passed",
    queuedAt: 1,
    attempts: 1,
    startedAt: 1,
    finishedAt: 2,
    dir: "/private/run",
    frames: [],
    steps: [],
    artifacts: [],
    ...input,
  }) as PersistedRun;
const capture = (index: number) => ({
  kind: "capture-review",
  capturedAt: index,
  data: {
    framePath: `frames/${index}.png`,
    imageSha256: hash,
    caption: `Capture ${index}`,
    checkpointId: `checkpoint-${index}`,
    configuration: { account: "member", browser: "chromium", viewport: "1280x800" },
  },
});

test("long valid revision display metadata stays bounded without losing the Run or exact SHA", () => {
  const sourceRevision = {
    vcs: "git" as const,
    sha: "b".repeat(40),
    branch: "branch-" + "x".repeat(260),
    artifactDigest: "artifact-" + "y".repeat(260),
    buildId: "build-" + "z".repeat(260),
  };
  const manifest = buildRunPanelManifest(run({ sourceRevision, artifacts: [capture(0)] }));
  const parsed = runPanelManifestSchema.parse(manifest);
  assert.equal(parsed.run.id, "run-1");
  assert.equal(parsed.run.sourceRevision?.sha, sourceRevision.sha);
  assert.equal(parsed.coverage.pending, 1);
  assert.equal(parsed.frames.items[0]?.imageSha256, hash);
  for (const field of ["branch", "artifactDigest", "buildId"] as const) {
    assert.equal(parsed.run.sourceRevision?.[field]?.length, 240);
    assert.ok(parsed.run.sourceRevision?.[field]?.endsWith("…"));
    assert.ok(sourceRevision[field].length > 240);
  }
});

test("bounded manifest retains canonical review decisions and the complete planned denominator", () => {
  const r = run({ artifacts: Array.from({ length: 50 }, (_, i) => capture(i)) });
  const initial = buildRunPanelManifest(r);
  assert.equal(initial.coverage.planned, 50);
  assert.equal(initial.coverage.pending, 50);
  assert.equal(initial.frames.items.length, 40);
  assert.equal(initial.frames.totalCount, 50);
  assert.equal(initial.frames.nextOffset, 40);
  assert.equal(initial.frames.truncated, true);
  const next = buildRunPanelManifest(r, { offset: 40, limit: 1 });
  assert.equal(next.frames.items[0]?.index, 40);
  assert.equal(next.frames.items[0]?.file, "40.png");
  assert.equal(next.frames.items[0]?.configuration?.account, "member");
  assert.equal(next.coverage.planned, 50);
  assert.equal(next.frames.items.length, 1);
  assert.doesNotMatch(JSON.stringify(next), /\/private|content|base64/);
  assert.doesNotThrow(() => runPanelManifestSchema.parse(next));
});

test("blocked execution retains frozen missing capture obligations", () => {
  const manifest = buildRunPanelManifest(
    run({
      status: "blocked",
      outcome: "harness-failure",
      recipeSnapshot: {
        id: "required",
        title: "Required",
        source: "custom",
        createdAt: 1,
        updatedAt: 1,
        steps: [
          {
            id: "capture-checkout",
            kind: "screenshot",
            caption: "Required checkout",
            review: { mode: "later" },
          },
        ],
      } as PersistedRun["recipeSnapshot"],
    }),
  );
  assert.equal(manifest.run.outcome, "harness-failure");
  assert.equal(manifest.coverage.planned, 1);
  assert.equal(manifest.coverage.blocked, 1);
  assert.equal(manifest.coverage.captured, 0);
  assert.equal(manifest.frames.items[0]?.blocked, true);
  assert.equal(manifest.frames.items[0]?.file, undefined);
});

test("repair and failed checks keep preceding failure and exact source revision", () => {
  const manifest = buildRunPanelManifest(
    run({
      status: "healed",
      attempts: 2,
      retryOf: "failed-run",
      healMessage: "Recovered after failure: Save missing",
      sourceRevision: { vcs: "git", sha: "b".repeat(40) },
      steps: [
        { title: "Save missing", status: "error" },
        { title: "Saved", status: "healed", heal: "After fixing Save" },
      ] as PersistedRun["steps"],
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 1,
          data: { title: "Save check before repair", status: "failed" },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 2,
          data: { title: "Save check after repair", status: "passed" },
        },
      ],
    }),
  );
  assert.equal(manifest.run.sourceRevision?.sha, "b".repeat(40));
  assert.equal(manifest.run.attempts, 2);
  assert.equal(manifest.run.retryOf, "failed-run");
  assert.equal(manifest.run.history[0]?.status, "error");
  assert.equal(manifest.checks.failed, 1);
  assert.equal(manifest.checks.passed, 1);
});
