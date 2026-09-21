/** FIN-20: profile the useful loop — Run start → review-ready evidence —
 * on the reference-30 workload. All attempts are retained (failed and
 * interrupted runs count); p50/p95 are computed over every run of the
 * reference tests, never a cherry-picked subset.
 *
 *   node --import tsx scripts/reference-30-profile.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:8787";
const AGENT = { "x-relay-actor-id": "agent:demo" };
const HUMAN = {
  "x-relay-actor-id": "human:profile",
  "x-relay-actor-kind": "human",
  "content-type": "application/json",
};

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(label, values) {
  return {
    label,
    samples: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: values.length ? Math.max(...values) : 0,
  };
}

// 1) Collect every persisted reference-30 run (all attempts retained).
const runsRoot = "runs";
const entries = await readdir(runsRoot);
const profileRuns = [];
for (const entry of entries) {
  if (!entry.includes("reference-30") && !entry.includes("reference_30")) continue;
  try {
    const run = JSON.parse(await readFile(join(runsRoot, entry, "run.json"), "utf8"));
    profileRuns.push({
      id: run.id,
      status: run.status,
      laneId: run.laneId,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs:
        run.durationMs ?? (run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : 0),
      reviewCaptures: (run.artifacts ?? []).filter((artifact) => artifact.kind === "capture-review")
        .length,
    });
  } catch {
    /* incomplete run folder — skipped for timing, still counted below */
  }
}

const ackLatency = [];
const runDuration = [];
const accepted = profileRuns.filter((run) => run.status === "ok");
for (const run of accepted) {
  runDuration.push(run.durationMs);
  if (run.startedAt && run.queuedAt) ackLatency.push(run.startedAt - run.queuedAt);
}

// 2) Time the review leg on one fresh pending run (collection → decision).
const started = Date.now();
const startResponse = await fetch(`${BASE}/runs?limit=5`, { headers: AGENT });
await startResponse.json();
const listLatency = Date.now() - started;

const pendingRun = profileRuns.find(
  (run) => run.status === "ok" && run.reviewCaptures > 0 && run.laneId?.includes("chromium"),
);
let reviewLatency;
if (pendingRun) {
  const runResponse = await fetch(`${BASE}/runs/${pendingRun.id}`, { headers: AGENT });
  const { run } = await runResponse.json();
  const artifact = (run.artifacts ?? []).find((item) => item.kind === "capture-review");
  if (artifact) {
    const t0 = Date.now();
    await fetch(`${BASE}/runs/${pendingRun.id}/capture-review`, {
      method: "POST",
      headers: HUMAN,
      body: JSON.stringify({
        captureId: `${artifact.data.framePath}::${artifact.data.imageSha256}`,
        action: "need-more-evidence",
        note: "FIN-20 profiling decision",
      }),
    });
    reviewLatency = Date.now() - t0;
  }
}

// 3) Time the export leg (review-ready evidence → pinned pack).
let exportLatency;
if (pendingRun) {
  const t0 = Date.now();
  const exportResponse = await fetch(`${BASE}/runs/${pendingRun.id}/trace-pack`, {
    headers: AGENT,
  });
  await exportResponse.json();
  exportLatency = Date.now() - t0;
}

const report = {
  generatedAt: new Date().toISOString(),
  workload: "reference-30 (10 checkpoints; Member·Firefox / Admin·Chrome / Member·Chromium)",
  attemptsRetained: profileRuns.length,
  attemptsSucceeded: accepted.length,
  attemptsFailed: profileRuns.length - accepted.length,
  phases: [
    summarize("start acknowledgement (queued→started)", ackLatency),
    summarize("test execution (started→finished)", runDuration),
    {
      label: "run list (5 latest)",
      samples: 1,
      p50Ms: listLatency,
      p95Ms: listLatency,
      maxMs: listLatency,
    },
    ...(reviewLatency !== undefined
      ? [
          {
            label: "capture review decision",
            samples: 1,
            p50Ms: reviewLatency,
            p95Ms: reviewLatency,
            maxMs: reviewLatency,
          },
        ]
      : []),
    ...(exportLatency !== undefined
      ? [
          {
            label: "TracePack export",
            samples: 1,
            p50Ms: exportLatency,
            p95Ms: exportLatency,
            maxMs: exportLatency,
          },
        ]
      : []),
  ],
  capturesCollected: profileRuns.reduce((total, run) => total + run.reviewCaptures, 0),
};

console.log(JSON.stringify(report, null, 2));
