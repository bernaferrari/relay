/** Contributor first run. All interaction, Test persistence and capture use Relay. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { RelayClient } from "../packages/client/src/index.ts";
import { createProductRecordingJourneyFromClient } from "../packages/product/src/recording-journey.ts";
import { createRelayRunOutcomeJobs } from "../packages/workflows/src/run-outcome-jobs.ts";
import { listenSeededMemberApp } from "../packages/core/src/seeded-member-app.ts";
import { buildWorkspaceDoctorReport } from "./workspace-doctor.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appMapId = "relay-first-run";
const targetId = "browser-relay-first-run";
const title = "Demo · Member settings";

function requireState(state, expected) {
  if (state.status !== expected || state.recovery) {
    throw new Error(
      `${state.recovery?.title ?? `Expected ${expected}, got ${state.status}`}. ${state.recovery?.detail ?? ""} ${state.recovery?.recovery ?? "Inspect the retained recording in Relay before trying again."}`,
    );
  }
  return state;
}

export async function runFirstDemo({
  serverUrl = process.env.RELAY_URL ?? "http://127.0.0.1:8787",
  port = 8792,
  once = false,
  workspaceRoot = root,
  prerequisiteReport,
  createLocalReport = false,
  repeatCommand,
  authToken = process.env.RELAY_AUTH_TOKEN,
  actorId = process.env.RELAY_ACTOR_ID ?? "agent:first-run-demo",
} = {}) {
  const manifestPath = resolve(workspaceRoot, ".relay/first-run-demo.json");
  // This command stays local: no credentials or account cookies are needed.
  const serverAddress = new URL(serverUrl);
  if (
    serverAddress.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(serverAddress.hostname)
  ) {
    throw new Error("The first-run demo requires a local Relay server (http://127.0.0.1:8787).");
  }
  const doctor = prerequisiteReport ?? buildWorkspaceDoctorReport({ requireBrowser: true });
  if (!doctor.ready) throw new Error(`${doctor.failures.join("\n")}\nRun: pnpm doctor -- --web`);
  const response = await fetch(`${serverUrl}/health`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  const health = response?.ok ? await response.json() : undefined;
  if (health?.product !== "relay") {
    throw new Error(`Relay is unavailable at ${serverUrl}. Start it with: pnpm ensure:serve`);
  }
  if (health.activeJobs?.length) {
    throw new Error("Relay has an active run. Let it finish, then run this demo again.");
  }
  let fixture;
  try {
    fixture = await listenSeededMemberApp({ port, defect: true });
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new Error(`Demo port ${port} is already in use. Close the earlier demo, then retry.`);
    }
    throw error;
  }
  const close = () =>
    new Promise((done) => {
      fixture.server.close(done);
      // Browser keep-alive sockets must not keep a finished demo process alive.
      // This fixture is owned solely by this invocation, never another app.
      fixture.server.closeAllConnections();
    });
  let successful = false;
  try {
    const client = new RelayClient({
      url: serverUrl,
      auth: authToken ? { type: "bearer", token: authToken } : { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId,
      actorKind: "agent",
    });
    const maps = await client.invoke("app-map.list", {});
    if (!maps.appMaps.some((map) => map.id === appMapId)) {
      await client.invoke("app-map.create", { appMapId, name: "Relay demo" });
    }
    const targets = await client.invoke("target.list", {});
    const existingTarget = targets.targets.find((target) => target.id === targetId);
    if (existingTarget && existingTarget.browser?.startUrl !== fixture.url) {
      throw new Error("The demo target has been changed. Restore its demo URL before repeating.");
    }
    if (!existingTarget) {
      await client.invoke("target.create", {
        id: targetId,
        name: "Demo website · Signed out",
        startUrl: fixture.url,
        headless: true,
        viewport: { width: 1100, height: 760 },
      });
    }
    let saved;
    try {
      saved = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let testId = saved?.testId;
    if (!testId) {
      console.log("Record: sign in as Member → open Settings → capture Member settings");
      const recording = createProductRecordingJourneyFromClient({ client, actorId });
      requireState(await recording.begin({ title, appMapId, targetId }), "recording");
      requireState(
        await recording.record({ kind: "tap", target: { label: "Continue as Member" } }),
        "recording",
      );
      requireState(
        await recording.record({ kind: "tap", target: { label: "Settings" } }),
        "recording",
      );
      requireState(await recording.checkpoint("Member settings"), "recording");
      const reviewed = requireState(await recording.stop(), "reviewing");
      const result = requireState(
        await recording.save({
          testName: title,
          reviewRevision: reviewed.snapshot.review.currentRevision,
        }),
        "saved",
      );
      testId = result.snapshot.authoring.committedTestId;
      if (!testId)
        throw new Error("Relay saved no reusable Test ID; inspect the retained recording.");
      await mkdir(resolve(workspaceRoot, ".relay"), { recursive: true });
      await writeFile(manifestPath, JSON.stringify({ appMapId, targetId, testId }, null, 2));
    }
    console.log(`Run: ${title} (fresh signed-out browser)`);
    const runs = createRelayRunOutcomeJobs(client, { actorId });
    let run = await runs.run({ kind: "run-test", appMapId, testId, targetId });
    if (
      run.workflow &&
      !["succeeded", "failed", "cancelled", "needs-attention"].includes(run.phase)
    ) {
      run = await runs.watchWorkflow({
        workflowId: run.workflow.workflowId,
        initial: run,
        signal: AbortSignal.timeout(120_000),
      });
    }
    if (run.phase !== "succeeded" || !run.execution?.runId) {
      throw new Error(
        `Demo run ${run.phase}: ${run.problems.map((problem) => problem.detail).join(" ")}`,
      );
    }
    const runId = run.execution.runId;
    const result = await client.invoke("run.get", { runId });
    const capture = result.run.artifacts.findLast(
      (artifact) => artifact.kind === "capture-review" && artifact.data?.framePath,
    );
    if (!capture) throw new Error("Run completed without the required retained screenshot.");
    const frameName = capture.data.framePath.split("/").at(-1);
    const image = await fetch(
      `${serverUrl}/runs/${runId}/frames/${encodeURIComponent(frameName)}`,
      {
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          "X-Organization-Id": "local",
          "X-Project-Id": "default",
          "X-Relay-Actor-Id": actorId,
          "X-Relay-Actor-Kind": "agent",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!image.ok)
      throw new Error(`Screenshot export failed (${image.status}). Open the run in Relay.`);
    const bytes = Buffer.from(await image.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== capture.data.imageSha256) {
      throw new Error(
        "Screenshot export differs from the retained capture. Review remains pending.",
      );
    }
    const exportDir = resolve(workspaceRoot, ".relay/first-run-demo", runId);
    await mkdir(exportDir, { recursive: true });
    const screenshotPath = resolve(exportDir, "Member settings.png");
    await writeFile(screenshotPath, bytes);
    console.log(`Test ID: ${testId}`);
    console.log(`Run ID: ${runId}`);
    if (createLocalReport) {
      const report = await client.invoke("run.share.create", {
        runId,
        expiresInHours: 24,
        includeBatch: false,
      });
      console.log(`Review: ${new URL(report.path, serverUrl).href}`);
    } else {
      console.log(
        `Review: http://localhost:3000/#/tests/${testId}?target=${targetId}&run=${runId}&view=run`,
      );
    }
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(
      "Look for the seeded layout defect: Save overlaps the team seats. Inspect it in the gallery; record a decision in Relay.",
    );
    console.log(
      `Repeat: ${repeatCommand ?? `./bin/relay run ${testId} --map ${appMapId} --device ${targetId} --json`}`,
    );
    console.log(
      "Collection passed. Screenshot review is pending; the demo makes no human decision.",
    );
    successful = true;
    if (!once) {
      console.log("The demo website stays available for repeat runs. Press Ctrl+C when finished.");
      await new Promise((done) => {
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
      });
    }
    return { appMapId, targetId, testId, runId, capture };
  } finally {
    await close();
    if (!successful)
      console.error("Any saved draft/evidence remains in Relay. No input is retried.");
  }
}

if (
  process.argv[1]?.endsWith("first-run-demo.mjs") &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = process.argv.slice(2).filter((argument) => argument !== "--");
  if (options.some((argument) => argument !== "--once")) {
    console.error("Usage: pnpm demo [-- --once]");
    process.exitCode = 1;
  } else {
    try {
      await runFirstDemo({ once: options.includes("--once"), createLocalReport: true });
    } catch (error) {
      console.error(`Demo stopped: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
