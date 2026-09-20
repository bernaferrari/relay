/** Slice 4/6 reference-task demo: the frozen pilot as one command.
 *
 *   node --import tsx scripts/slice4-reference-demo.mjs
 *
 * Exercises the complete product sentence on the seeded-member controlled app
 * through the everyday CLI surface: run coverage through a saved Lane
 * (immutable account fixture), seed a visual defect, review it (report an
 * issue on the exact capture), repair, rerun the same coverage, accept the
 * repair under the same criterion, and emit the report where execution and
 * human review stay side by side.
 *
 * Prerequisites: the Relay server on :8787 (pnpm ensure:serve) and the
 * seeded-member app on :8791 (node --import tsx scripts/slice4-seeded-member-host.mjs 8791).
 * Requires the slice4-reference App Map with the slice4-member Lane and the
 * test-member-v2 Test (created during the Slice 4 pilot; see
 * docs/release/PRODUCT-DIRECTION.md). */
import { execFileSync } from "node:child_process";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:8787";
const APP = process.env.SEEDED_APP_URL ?? "http://127.0.0.1:8791";
const HUMAN = { "x-relay-actor-id": "human:demo", "x-relay-actor-kind": "human" };
const AGENT = { "x-relay-actor-id": "agent:demo", "x-relay-actor-kind": "agent" };

function fail(step, detail) {
  console.error(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

async function api(path, init = {}, attempt = 0) {
  let response;
  for (let tries = 0; ; tries += 1) {
    try {
      response = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
      break;
    } catch (error) {
      // The watched dev server briefly recycles; a live Plan must never be
      // disturbed, so the demo just waits and retries its read.
      if (tries >= 3) fail(path, String(error));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status >= 500 && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(path, init, attempt + 1);
  }
  if (!response.ok) fail(path, JSON.stringify(body).slice(0, 300));
  return body;
}

async function setDefect(on) {
  const response = await fetch(`${APP}/control/defect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on }),
  });
  if (!response.ok) fail("setDefect", String(response.status));
}

function runMemberLane() {
  const stdout = execFileSync(
    "./bin/relay",
    ["run", "test-member-v2", "--map", "slice4-reference", "--lane", "slice4-member", "--json"],
    { env: { ...process.env, RELAY_URL: BASE, RELAY_ACTOR_ID: "agent:demo" }, timeout: 170_000 },
  ).toString("utf8");
  const lines = stdout.trim().split("\n");
  const result = JSON.parse(lines.at(-1) ?? "{}");
  const runId = result?.result?.execution?.runId ?? result?.error?.details?.execution?.runId;
  const phase = result?.result?.phase ?? result?.error?.details?.phase;
  if (!runId || phase !== "succeeded") fail("runMemberLane", `phase=${phase}`);
  return runId;
}

async function reviewCapture(runId) {
  const { run } = await api(`/runs/${runId}`, { headers: AGENT });
  const artifact = (run.artifacts ?? []).find((item) => item.kind === "capture-review");
  if (!artifact) fail("reviewCapture", `run ${runId} has no capture-review artifact`);
  return `${artifact.data.framePath}::${artifact.data.imageSha256}`;
}

async function decide(runId, capture, action, note) {
  await api(`/runs/${runId}/capture-review`, {
    method: "POST",
    headers: HUMAN,
    body: JSON.stringify({ captureId: capture, action, note }),
  });
}

function report(runId) {
  // Like `relay db`, the proof projection reads the persisted run from disk —
  // it must produce the same report in CI where no server is running.
  const stdout = execFileSync("./bin/relay", ["report", "emit", "--run", runId, "--json"], {
    env: { ...process.env, RELAY_URL: BASE },
    timeout: 60_000,
  }).toString("utf8");
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines.at(-1) ?? "{}");
}

console.log("== Relay reference-task demo (docs/release/PRODUCT-DIRECTION.md)");
console.log("1. seed the visual defect");
await setDefect(true);
console.log("2. run the same member coverage (immutable fixture lane)");
const defectRun = await runMemberLane();
console.log(`   defect run ${defectRun}`);
const defectCapture = await reviewCapture(defectRun);
console.log("3. review: report the issue on the exact capture");
await decide(
  defectRun,
  defectCapture,
  "report-issue",
  "Demo: Save overlaps the heading area — seeded layout defect.",
);
console.log("4. repair (defect off) and rerun the SAME coverage");
await setDefect(false);
const repairRun = await runMemberLane();
console.log(`   repair run ${repairRun}`);
const repairCapture = await reviewCapture(repairRun);
console.log("5. review: accept the repair under the same criterion");
await decide(
  repairRun,
  repairCapture,
  "accept",
  "Demo: Save inline again — same criterion accepts the repair.",
);
const defectReport = report(defectRun);
const repairReport = report(repairRun);
console.log("6. reports keep execution and human review side by side");
console.log(
  `   defect run : verdict=${defectReport.verdict} review=${JSON.stringify(defectReport.captureReview)}`,
);
console.log(
  `   repair run : verdict=${repairReport.verdict} review=${JSON.stringify(repairReport.captureReview)}`,
);
const issueOk = defectReport.captureReview?.issue === 1;
const acceptOk = repairReport.captureReview?.accepted === 1;
if (!issueOk || !acceptOk) fail("reports", "expected issue=1 then accepted=1");
console.log("PASS — collect, decide, repair, rerun, report; three outcomes never folded.");
