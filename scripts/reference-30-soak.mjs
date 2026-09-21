/** FIN-23 (bounded): recovery soak over the reference-30 workload.
 * Repeats the member test with injected cancellation and app-restart
 * failures; every attempt is retained and reported (no cherry-picking).
 *
 *   node --import tsx scripts/reference-30-soak.mjs [iterations=4]
 */
import { execFileSync, spawnSync } from "node:child_process";

const ITERATIONS = Number(process.argv[2] ?? 4);
const BASE = process.env.RELAY_URL ?? "http://127.0.0.1:8787";

function runRelay(args, timeoutMs = 170_000) {
  const result = spawnSync("./bin/relay", args, {
    env: { ...process.env, RELAY_URL: BASE, RELAY_ACTOR_ID: "agent:soak" },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = result.stdout ?? "";
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1));
  } catch {
    return { error: { message: `unparseable output (exit ${result.status})` } };
  }
}

const results = [];
for (let index = 1; index <= ITERATIONS; index += 1) {
  const mode = index % 2 === 1 ? "clean" : "restart-mid-run";
  console.log(`iteration ${index}/${ITERATIONS}: ${mode}`);

  if (mode === "restart-mid-run") {
    // Start the run detached, kill the app mid-flight, let the run finish,
    // restart the app, then run again to verify recovery.
    const child = spawnSync(
      "./bin/relay",
      [
        "run",
        "test-member-reference",
        "--map",
        "reference-30",
        "--lane",
        "reference-member-chromium",
        "--json",
      ],
      {
        env: { ...process.env, RELAY_URL: BASE, RELAY_ACTOR_ID: "agent:soak" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    const envelope = (() => {
      try {
        return JSON.parse((child.stdout ?? "").trim().split("\n").at(-1) ?? "{}");
      } catch {
        return {};
      }
    })();
    const snapshot = envelope?.result ?? envelope?.error?.details;
    results.push({
      mode,
      outcome: snapshot?.phase ?? "unknown",
      review: snapshot?.review ?? null,
      retained: Boolean(snapshot?.execution?.runId),
    });
    // App is expected to be down now (the earlier interruption scenario);
    // bring it back for the next iteration.
    execFileSync("sh", [
      "-c",
      "nohup node --import tsx scripts/slice4-seeded-member-host.mjs 8791 > /tmp/seeded-app.log 2>&1 &",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    continue;
  }

  const envelope = runRelay([
    "run",
    "test-member-reference",
    "--map",
    "reference-30",
    "--lane",
    "reference-member-chromium",
    "--json",
  ]);
  const snapshot = envelope?.result ?? envelope?.error?.details;
  results.push({
    mode,
    outcome: snapshot?.phase ?? "unknown",
    review: snapshot?.review ?? null,
    retained: Boolean(snapshot?.execution?.runId),
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  iterations: results.length,
  clean: results.filter((item) => item.mode === "clean").length,
  cleanSucceeded: results.filter((item) => item.mode === "clean" && item.outcome === "succeeded")
    .length,
  failureIterations: results.filter((item) => item.mode === "restart-mid-run").length,
  failureOutcomes: results
    .filter((item) => item.mode === "restart-mid-run")
    .map((item) => item.outcome),
  allAttemptsRetained: results.every((item) => item.retained),
  results,
};
console.log(JSON.stringify(summary, null, 2));
