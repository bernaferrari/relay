/** Contributor first run. All interaction, Test persistence and capture use Relay. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { RelayClient } from "../packages/client/src/index.ts";
import { createProductRecordingJourneyFromClient } from "../packages/product/src/recording-journey.ts";
import { createRelayRunOutcomeJobs } from "../packages/workflows/src/run-outcome-jobs.ts";
import { listenSeededMemberApp } from "../packages/core/src/seeded-member-app.ts";
import { buildWorkspaceDoctorReport } from "./workspace-doctor.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appMapId = "relay-first-run";
const targetId = "browser-relay-first-layout";
const title = "Demo · Member layout";
const checkVersion = 1;

function requireState(state, expected) {
  if (state.status !== expected || state.recovery) {
    throw new Error(
      `${state.recovery?.title ?? `Expected ${expected}, got ${state.status}`}. ${state.recovery?.detail ?? ""} ${state.recovery?.recovery ?? "Inspect the retained recording in Relay before trying again."}`,
    );
  }
  return state;
}

async function readDemoManifest(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function openDemoFixture({ port, reuseFixture, saved, restartDemo }) {
  if (reuseFixture) {
    if (
      saved?.appMapId !== appMapId ||
      saved?.targetId !== targetId ||
      !saved.testId ||
      saved.checkVersion !== checkVersion ||
      !saved.fixtureUrl ||
      !saved.fixtureId
    ) {
      throw new Error(`No live demo is recorded in this workspace. ${restartDemo}`);
    }
    const address = new URL(saved.fixtureUrl);
    if (
      address.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)
    ) {
      throw new Error(`The recorded demo website is not local. ${restartDemo}`);
    }
    const response = await fetch(new URL("/control/defect", address), {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    if (!response?.ok || response.headers.get("x-relay-demo-fixture") !== saved.fixtureId) {
      throw new Error(
        `The original demo website is no longer running. ${restartDemo} No browser input was sent.`,
      );
    }
    const state = await response.json();
    if (typeof state.on !== "boolean")
      throw new Error(`The demo state is unavailable. ${restartDemo}`);
    return { url: saved.fixtureUrl, fixtureId: saved.fixtureId, defectOn: state.on };
  }
  const fixture = await listenSeededMemberApp({ port, defect: true });
  const fixtureId = randomUUID();
  fixture.server.prependListener("request", (_request, response) => {
    response.setHeader("x-relay-demo-fixture", fixtureId);
  });
  return { ...fixture, fixtureId, defectOn: true };
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
  reuseFixture = false,
  recovery = {},
} = {}) {
  const manifestPath = resolve(workspaceRoot, ".relay/first-run-demo.json");
  const restartDemo = recovery.restartDemo ?? "Start pnpm demo again, leave it open, then repeat.";
  const saved = await readDemoManifest(manifestPath);
  // This command stays local: no credentials or account cookies are needed.
  const serverAddress = new URL(serverUrl);
  if (
    serverAddress.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(serverAddress.hostname)
  ) {
    throw new Error("The first-run demo requires a local Relay server (http://127.0.0.1:8787).");
  }
  const doctor = prerequisiteReport ?? buildWorkspaceDoctorReport({ requireBrowser: true });
  if (!doctor.ready)
    throw new Error(
      `${doctor.failures.join("\n")}\n${recovery.missingBrowser ?? "Run: pnpm doctor -- --web"}`,
    );
  const response = await fetch(`${serverUrl}/health`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  const health = response?.ok ? await response.json() : undefined;
  if (health?.product !== "relay") {
    throw new Error(
      `Relay is unavailable at ${serverUrl}. ${recovery.unavailableServer ?? "Start it with: pnpm ensure:serve"}`,
    );
  }
  if (health.activeJobs?.length) {
    throw new Error("Relay has an active run. Let it finish, then run this demo again.");
  }
  let fixture;
  try {
    fixture = await openDemoFixture({ port, reuseFixture, saved, restartDemo });
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new Error(`Demo port ${port} is already in use. Close the earlier demo, then retry.`);
    }
    throw error;
  }
  const close = () =>
    new Promise((done) => {
      if (!fixture.server) return done();
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
      if (reuseFixture) throw new Error(`The saved demo App is missing. ${restartDemo}`);
      await client.invoke("app-map.create", { appMapId, name: "Relay demo" });
    }
    const targets = await client.invoke("target.list", {});
    const existingTarget = targets.targets.find((target) => target.id === targetId);
    if (existingTarget && existingTarget.browser?.startUrl !== fixture.url) {
      throw new Error("The demo target has been changed. Restore its demo URL before repeating.");
    }
    if (!existingTarget) {
      if (reuseFixture) throw new Error(`The saved demo destination is missing. ${restartDemo}`);
      await client.invoke("target.create", {
        id: targetId,
        name: "Demo website · Signed out",
        startUrl: fixture.url,
        headless: true,
        viewport: { width: 1100, height: 760 },
      });
    }
    // Preserve historical capture-only Tests. The checked demo gets its own
    // saved Test rather than silently changing a previously recorded recipe.
    let testId =
      saved?.checkVersion === checkVersion && saved.targetId === targetId
        ? saved.testId
        : undefined;
    if (!testId) {
      console.log("Record: sign in as Member → open Settings → capture Member settings");
      fixture.app.setDefect(false);
      const recordingClient = {
        invoke: async (...args) => {
          try {
            return await client.invoke(...args);
          } catch (error) {
            console.error(
              `Demo operation ${args[0]} failed: ${error.message} ${error.cause?.code ?? ""}`,
            );
            throw error;
          }
        },
      };
      const recording = createProductRecordingJourneyFromClient({
        client: recordingClient,
        actorId,
      });
      requireState(
        await recording.begin({ title, appMapId, targetId, targetKind: "browser" }),
        "recording",
      );
      requireState(
        await recording.record({
          kind: "steps",
          label: "Sign in, open Settings, and check the layout",
          steps: [
            { kind: "wait-for", target: { label: "Continue as Member" }, timeoutMs: 5_000 },
            { kind: "tap", target: { label: "Continue as Member" } },
            { kind: "wait-for", target: { label: "Settings" }, timeoutMs: 5_000 },
            { kind: "tap", target: { label: "Settings" } },
            { kind: "wait-for", target: { identifier: "team-seats" }, timeoutMs: 5_000 },
            { kind: "wait-for", target: { identifier: "save-settings" }, timeoutMs: 5_000 },
            {
              kind: "screenshot",
              id: "member-settings-layout",
              caption: "Member settings layout",
              review: {
                mode: "later",
                policy: "fast",
                lookFor: "Save and team seats are readable without overlap",
              },
            },
            {
              kind: "assert-layout",
              relation: "non-overlap",
              first: { identifier: "team-seats" },
              second: { identifier: "save-settings" },
              timeoutMs: 0,
            },
          ],
        }),
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
      fixture.app.setDefect(true);
    }
    if (!reuseFixture) {
      await mkdir(resolve(workspaceRoot, ".relay"), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            appMapId,
            targetId,
            testId,
            checkVersion,
            fixtureUrl: fixture.url,
            fixtureId: fixture.fixtureId,
          },
          null,
          2,
        ),
      );
    }
    const runs = createRelayRunOutcomeJobs(client, { actorId });
    const executeTest = async () => {
      console.log(`Run: ${title} (fresh signed-out browser)`);
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
      if (!run.execution?.runId)
        throw new Error(
          `Demo run ${run.phase}: no retained Run ID. Inspect Relay before retrying.`,
        );
      const result = await client.invoke("run.get", { runId: run.execution.runId });
      return { run, result };
    };
    const retainEvidence = async ({ run, result }, prefix = "") => {
      const runId = run.execution.runId;
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
      console.log(`${prefix}Test ID: ${testId}`);
      console.log(`${prefix}Run ID: ${runId}`);
      if (result.run.startedAt && result.run.finishedAt) {
        console.log(
          `${prefix}Duration: ${((result.run.finishedAt - result.run.startedAt) / 1000).toFixed(1)} s`,
        );
      }
      if (createLocalReport) {
        const report = await client.invoke("run.share.create", {
          runId,
          expiresInHours: 24,
          includeBatch: false,
        });
        console.log(`${prefix}Review: ${new URL(report.path, serverUrl).href}`);
      } else {
        console.log(
          `${prefix}Review: http://localhost:3000/#/tests/${testId}?target=${targetId}&run=${runId}&view=run`,
        );
      }
      console.log(`${prefix}Screenshot: ${screenshotPath}`);
      return { runId, capture };
    };
    if (!reuseFixture) {
      const defective = await executeTest();
      const failedLayout = defective.result.run.artifacts.find(
        (artifact) =>
          artifact.kind === "layout-assertion" &&
          artifact.data?.passed === false &&
          /overlap/i.test(artifact.data.error ?? ""),
      );
      await retainEvidence(defective, "Defect ");
      if (
        defective.run.phase !== "failed" ||
        defective.result.run.outcome !== "product-failure" ||
        !failedLayout
      ) {
        throw new Error(
          "The demo did not prove the intended overlap. Inspect the Defect Review; no repair was applied.",
        );
      }
      console.log("Caught the defect: Save overlaps the team seats (layout check failed).");
      fixture.app.setDefect(false);
      console.log(
        "Repair: removed the overlap in this owned demo website; rerunning the unchanged Test.",
      );
    }
    const checked = await executeTest();
    const { runId, capture } = await retainEvidence(checked);
    if (
      checked.run.phase !== "succeeded" ||
      !checked.result.run.artifacts.some(
        (artifact) => artifact.kind === "layout-assertion" && artifact.data?.passed === true,
      )
    ) {
      throw new Error(
        `Demo check failed: ${checked.run.problems.map((problem) => problem.detail).join(" ")} Evidence was retained; no browser input is retried.`,
      );
    }
    console.log(
      `Repeat: ${repeatCommand ?? `./bin/relay run ${testId} --map ${appMapId} --device ${targetId} --json`}`,
    );
    console.log(
      "Layout check passed. Screenshot review is pending; the demo makes no human decision.",
    );
    successful = true;
    if (!once && !reuseFixture) {
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
