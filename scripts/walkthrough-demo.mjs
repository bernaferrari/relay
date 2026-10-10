/** One-command walkthrough demo (delivery plan §6.6): three real states,
 * two recorded connections, one authored link, two configurations with one
 * missing state, one finding on one exact capture.
 *
 *   node --import tsx scripts/walkthrough-demo.mjs
 *
 * Prerequisites: Relay server on :8787 (pnpm ensure:serve), seeded-member
 * app on :8791 (node --import tsx scripts/slice4-seeded-member-host.mjs 8791),
 * and the walkthrough-demo map+lanes (scripts/walkthrough-demo-seed.mjs,
 * including the live alias-observe steps below).
 *
 * First-time map authoring (one-off, already applied in this workspace):
 *   1. node --import tsx scripts/walkthrough-demo-seed.mjs
 *   2. alias-observe screen-language on the member browser (language page),
 *      and the home/settings screens on the admin browser, so identities
 *      come from real observation rather than invention.
 */
import { execFileSync } from "node:child_process";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:8787";
const AGENT = { "x-relay-actor-id": "agent:demo", "x-relay-actor-kind": "agent" };
const HUMAN = { "x-relay-actor-id": "human:demo", "x-relay-actor-kind": "human" };

function fail(step, detail) {
  console.error(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

function runLane(testId, laneId) {
  // Exit 0 = nothing left to decide; exit 10 = collection completed with
  // captures awaiting human review (this demo reviews one on purpose).
  // execFileSync throws on non-zero, so read the envelope from the error.
  let stdout = "";
  try {
    stdout = execFileSync(
      "./bin/relay",
      ["run", testId, "--map", "walkthrough-demo", "--lane", laneId, "--json"],
      {
        env: { ...process.env, RELAY_URL: BASE, RELAY_ACTOR_ID: "agent:demo" },
        encoding: "utf8",
        timeout: 170_000,
      },
    );
  } catch (error) {
    stdout = error.stdout ?? "";
  }
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
}
async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) fail(path, String(response.status));
  return response.json();
}

console.log("1. member coverage: Home → Settings → Language (three real states)");
const member = runLane("test-member-v2", "walkthrough-member");
const memberRunId = member?.result?.execution?.runId ?? member?.error?.details?.execution?.runId;
if (!memberRunId) fail("member run", JSON.stringify(member).slice(0, 200));

console.log("2. admin coverage: Home → Settings (Language intentionally absent)");
const admin = runLane("test-admin-settings", "walkthrough-admin");
const adminRunId = admin?.result?.execution?.runId ?? admin?.error?.details?.execution?.runId;
if (!adminRunId) fail("admin run", JSON.stringify(admin).slice(0, 200));

console.log("3. one finding on one exact member capture (human decision)");
const memberRun = await api(`/runs/${memberRunId}`, { headers: AGENT });
const artifact = (memberRun.run.artifacts ?? []).find((item) => item.kind === "capture-review");
if (!artifact) fail("review", "member run has no capture-review artifact");
const captureId = `${artifact.data.framePath}::${artifact.data.imageSha256}`;
await api(`/runs/${memberRunId}/capture-review`, {
  method: "POST",
  headers: HUMAN,
  body: JSON.stringify({
    captureId,
    action: "report-issue",
    note: "Save button overlaps the seats row",
  }),
});

console.log("4. player manifest across both configurations");
const manifest = await api(`/runs/${memberRunId}/player-manifest?with=${adminRunId}`, {
  headers: AGENT,
});
const m = manifest.manifest;
const states = m.states.map((state) => state.title).sort();
const missing = m.missing.map((entry) => entry.stateId);
const recorded = m.connections.filter((connection) => connection.kind === "recorded").length;
const authored = m.connections.filter((connection) => connection.kind === "authored").length;
console.log(`   states: ${states.join(" | ")}`);
console.log(
  `   variants: ${m.variants.length} · recorded links: ${recorded} · authored: ${authored}`,
);
console.log(
  `   missing (state × variant): ${missing.length === 1 ? missing[0] : missing.join(", ")}`,
);
console.log(`   findings: ${m.findings.length}`);
if (states.length !== 3 || m.variants.length !== 2 || recorded !== 2 || authored !== 1) {
  fail("manifest", "§6.6 shape mismatch");
}
if (missing.length !== 1 || missing[0] !== "screen-language") {
  fail("manifest", "expected exactly the Language state missing in the admin configuration");
}
if (m.findings.length !== 1) fail("manifest", "expected exactly one finding");

console.log(`\nOpen the run: #/runs/${memberRunId} in the Relay app`);
console.log(`Manifest: GET /runs/${memberRunId}/player-manifest?with=${adminRunId}`);
