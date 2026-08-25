import assert from "node:assert/strict";
import test from "node:test";
import { proofReportOutputParser } from "@relay/protocol";
import type { ProofReport } from "@relay/protocol";
import { buildProofReport, proofVerdict, renderProofReportMarkdown } from "./proof-report.js";
import type { PersistedRun } from "./runs.js";
import type { TraceStep } from "./trace.js";

function run(overrides: Partial<PersistedRun>): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-1",
    action: "app-map.test.run",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    logs: [],
    steps: [],
    frames: [],
    dir: "/tmp/run-1",
    writtenAt: 2,
    inputDigest: "digest",
    resolvedInputs: {},
    artifacts: [],
    ...overrides,
  } as PersistedRun;
}

function step(overrides: { title: string; tone: TraceStep["tone"]; status?: string }): TraceStep {
  return {
    id: overrides.title,
    index: 0,
    kind: "Replay",
    tone: overrides.tone,
    title: overrides.title,
    glyphs: [],
    frames: [],
    log: "",
    startedAt: 1,
    ...(overrides.status ? { status: overrides.status as TraceStep["status"] } : {}),
  };
}
test("verdict matrix: executed-and-held flows pass", () => {
  assert.equal(proofVerdict(run({ status: "ok", outcome: "passed" })), "pass");
  // Healed means the flow self-recovered and held — still a proof.
  assert.equal(proofVerdict(run({ status: "healed", healed: true, outcome: "passed" })), "pass");
  assert.equal(proofVerdict(run({ status: "ok" })), "pass");
});

test("verdict matrix: executed-and-broken flows fail", () => {
  assert.equal(
    proofVerdict(run({ status: "error", outcome: "product-failure", error: "expect-screen: cart empty" })),
    "fail",
  );
  assert.equal(
    proofVerdict(run({ status: "error", outcome: "harness-failure" })),
    "fail",
    "a harness failure that ran is a fail for the coding agent loop; unproven is reserved for could-not-execute",
  );
});

test("verdict matrix: could-not-execute is unproven, never fail", () => {
  assert.equal(proofVerdict(run({ status: "cancelled", outcome: "cancelled" })), "unproven");
  assert.equal(proofVerdict(run({ status: "queued" })), "unproven");
  assert.equal(proofVerdict(run({ status: "running" })), "unproven");
  assert.equal(proofVerdict(run({ status: "paused" })), "unproven");
  assert.equal(
    proofVerdict(run({ status: "error", outcome: "uncertain" })),
    "unproven",
    "uncertain evidence cannot name a product regression",
  );
});

test("buildProofReport projects flows with digest, step, and share path", () => {
  const report = buildProofReport({
    run: run({
      id: "job-checkout",
      title: "Checkout smoke",
      status: "error",
      outcome: "product-failure",
      error: "expect-screen: order confirmation never appeared\ncode 500",
      steps: [
        step({ title: "Open app", tone: "pass", status: "ok" }),
        step({ title: "Submit order", tone: "fail", status: "error" }),
        step({ title: "Never reached", tone: "dim" }),
      ],
      durationMs: 42_000,
    }),
    sharePath: "/shared/runs/token",
    relayServerUrl: "https://relay.example.test",
    at: 1_756_000_000_000,
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.verdict, "fail");
  assert.deepEqual(report.flows, [
    {
      testId: "job-checkout",
      title: "Checkout smoke",
      status: "error",
      durationMs: 42_000,
      failureDigest: report.flows[0]!.failureDigest,
      failureStep: { index: 1, total: 3, label: "Submit order" },
      sharePath: "/shared/runs/token",
    },
  ]);
  assert.match(report.flows[0]!.failureDigest!, /^[0-9a-f]{16}$/);
  assert.equal(report.relayServerUrl, "https://relay.example.test");
  assert.equal(report.generatedAt, 1_756_000_000_000);
});

test("buildProofReport carries source revision when frozen at enqueue", () => {
  const report = buildProofReport({
    run: run({
      sourceRevision: { vcs: "git", sha: "abc1234def5678", prNumber: 12 },
    }),
  });
  assert.deepEqual(report.sourceRevision, { vcs: "git", sha: "abc1234def5678", prNumber: 12 });
  const bare = buildProofReport({ run: run({}) });
  assert.equal(bare.sourceRevision, undefined);
});

test("markdown rendering is deterministic and one line per flow", () => {
  const input = {
    run: run({ id: "j1", title: "Login flow", status: "ok", outcome: "passed", durationMs: 900 }),
    at: 123,
  };
  const first = renderProofReportMarkdown(buildProofReport(input));
  const second = renderProofReportMarkdown(buildProofReport(input));
  assert.equal(first, second);
  assert.deepEqual(
    first.split("\n").filter((line) => line.startsWith("- ")),
    ["- ✅ **Login flow** · 900ms"],
  );
  assert.match(first, /Verdict: \*\*pass\*\*/);
});

test("markdown icons distinguish verdicts", () => {
  const failReport = buildProofReport({
    run: run({ status: "error", outcome: "product-failure", error: "assertion failed" }),
    at: 1,
  });
  assert.match(renderProofReportMarkdown(failReport), /❌/);
  const unprovenReport = buildProofReport({ run: run({ status: "queued" }), at: 1 });
  const markdown = renderProofReportMarkdown(unprovenReport);
  assert.match(markdown, /⚠️/);
  assert.match(markdown, /Verdict: \*\*unproven\*\*/);
});

test("proof report JSON survives a parse roundtrip through its output parser", async () => {
  const { proofReportOutputParser } = await import("@relay/protocol");
  const report: ProofReport = buildProofReport({
    run: run({
      id: "j2",
      title: "Signup flow",
      status: "error",
      outcome: "product-failure",
      error: "expect-screen: welcome banner missing",
      steps: [step({ title: "Tap sign up", tone: "fail", status: "error" })],
      sourceRevision: { vcs: "git", sha: "deadbeefdeadbee" },
    }),
    sharePath: "/shared/runs/t",
    at: 5,
  });
  const parsed = proofReportOutputParser.parse(JSON.parse(JSON.stringify(report)));
  assert.deepEqual(parsed, report);
  assert.throws(() => proofReportOutputParser.parse({ ...report, schemaVersion: 2 }));
  assert.throws(() => proofReportOutputParser.parse({ ...report, verdict: "maybe" }));
});
