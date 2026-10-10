/** The Relay demo: one command for the complete product sentence
 * (FIN-26/27 groundwork — local, deterministic, model-free).
 *
 *   node --import tsx scripts/demo.mjs
 *
 * Prerequisites (the script checks and reports, never silently skips):
 *   - Relay server on :8787        (pnpm ensure:serve)
 *   - seeded-member app on :8791   (node --import tsx scripts/slice4-seeded-member-host.mjs 8791)
 *
 * The tour: seed the visual defect → run the same member coverage →
 * report the issue on the exact capture → repair → rerun → accept →
 * walk the recorded app in the player → export the pinned evidence.
 */
import { execFileSync, spawnSync } from "node:child_process";

const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:8787";
const APP = process.env.SEEDED_APP_URL ?? "http://127.0.0.1:8791";

function fail(step, detail) {
  console.error(`FAIL ${step}: ${detail}`);
  process.exit(1);
}

async function health() {
  try {
    const response = await fetch(`${BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function appUp() {
  try {
    const response = await fetch(APP);
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await health())) {
  fail("prerequisites", `Relay server not reachable at ${BASE} — run: pnpm ensure:serve`);
}
if (!(await appUp())) {
  fail(
    "prerequisites",
    `seeded app not reachable at ${APP} — run: node --import tsx scripts/slice4-seeded-member-host.mjs 8791`,
  );
}

console.log("== Relay demo — the complete product sentence, model-free ==\n");
console.log("1/3 defect → review → repair loop (slice4 reference task)");
execFileSync("node", ["--import", "tsx", "scripts/slice4-reference-demo.mjs"], {
  stdio: "inherit",
});

console.log("\n2/3 captured-app walkthrough (three states, two configurations)");
execFileSync("node", ["--import", "tsx", "scripts/walkthrough-demo.mjs"], { stdio: "inherit" });

console.log("\n3/3 thirty-slot reference matrix summary");
const summary = spawnSync("./bin/relay", ["runs", "--json"], {
  env: { ...process.env, RELAY_URL: BASE },
  encoding: "utf8",
  timeout: 60_000,
});
try {
  const envelope = JSON.parse((summary.stdout ?? "").trim().split("\n").at(-1));
  const runs = envelope?.result?.runs ?? [];
  console.log(`   ${runs.length} recent runs retained on this server (all attempts kept).`);
} catch {
  console.log("   relay runs unavailable in this environment.");
}

console.log(`
Next:
  Walk through:  open the Relay app → any run → Walk through
  Review:        Results → open a run → review the pending captures
  Reset demo:    POST /control/defect {"on":false} on the seeded app, re-run this script
`);
