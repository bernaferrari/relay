import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RelayClient } from "@relay/client";
import {
  closeBrowserHostPool,
  closeBrowserTarget,
  listenSeededMemberApp,
  resetControlDatabaseCache,
  saveBrowserAuthenticationFixture,
  saveBrowserTarget,
  SEEDED_ADMIN_LANE_ID,
  SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE,
  SEEDED_MEMBER_ACCOUNT_VARIABLE_ID,
  SEEDED_MEMBER_APP_MAP_ID,
  SEEDED_MEMBER_COMBINE_ID,
  SEEDED_MEMBER_HOME_FINGERPRINT,
  SEEDED_MEMBER_HOME_SCREEN_ID,
  SEEDED_MEMBER_LANE_ID,
  SEEDED_MEMBER_TARGET_ID,
  SEEDED_MEMBER_TEST_ID,
  SEEDED_MEMBER_BROWSER_ENVIRONMENT,
  seededMemberAccidentalConnection,
  seededMemberAccountVariable,
  seededMemberCombine,
  seededMemberConnectionCreateInput,
  seededMemberGraphTest,
  seededMemberHomeVariant,
  seededMemberLane,
  seededMemberOpenSettingsConnection,
  seededMemberProfileId,
  waitForJobCompletion,
} from "@relay/core";
import { startServer } from "./index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const relayBin = join(repoRoot, "bin/relay");
const durableRoot = join(repoRoot, ".relay/seeded-member-acceptance");
const CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const actorId = "human:seeded-member";
const organizationId = "local";
const projectId = "default";
const scope = { organizationId, projectId, appMapId: SEEDED_MEMBER_APP_MAP_ID };

test(
  "Member Lane runs a seeded seats defect then the same check after repair",
  { timeout: 360_000 },
  async (t) => {
    try {
      await access(CHROME);
    } catch (error) {
      if (process.env.GOLDEN_ACCEPTANCE_MODE === "required" || process.env.RELAY_TEST_CHROME_PATH) {
        throw error;
      }
      t.skip(`Google Chrome is not installed: ${error instanceof Error ? error.message : error}`);
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "relay-seeded-member-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    const previousChrome = process.env.RELAY_BROWSER_EXECUTABLE;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    process.env.RELAY_BROWSER_EXECUTABLE = CHROME;
    resetControlDatabaseCache();
    const fixture = await listenSeededMemberApp({ defect: true });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      server = await startServer({ host: "127.0.0.1", port: 0 });
      const client = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId,
        projectId,
        actorId,
        actorKind: "human",
      });
      await saveBrowserTarget({
        id: SEEDED_MEMBER_TARGET_ID,
        name: "Seeded Member app",
        startUrl: fixture.url,
        headless: true,
        profileRetention: "ephemeral",
        environment: { ...SEEDED_MEMBER_BROWSER_ENVIRONMENT },
      });
      const memberFx = await issueFixture("member", fixture.url);
      const adminFx = await issueFixture("admin", fixture.url);
      let revision = (
        await client.invoke("app-map.create", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          name: "Seeded Member settings",
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.screen.add", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          expectedRevision: revision,
          screen: {
            id: SEEDED_MEMBER_HOME_SCREEN_ID,
            title: "Workspace home",
            identity: { schemaVersion: 1, fingerprint: SEEDED_MEMBER_HOME_FINGERPRINT },
          },
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.screen.update", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          screenId: SEEDED_MEMBER_HOME_SCREEN_ID,
          expectedRevision: revision,
          input: {
            patch: {},
            upsertVariants: [
              seededMemberHomeVariant({
                role: "member",
                fixtureReference: memberFx.reference,
                scope,
              }),
              seededMemberHomeVariant({
                role: "admin",
                fixtureReference: adminFx.reference,
                scope,
              }),
            ],
          },
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.connection.create", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          expectedRevision: revision,
          connection: seededMemberConnectionCreateInput(seededMemberOpenSettingsConnection(scope)),
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.connection.create", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          expectedRevision: revision,
          connection: seededMemberConnectionCreateInput(seededMemberAccidentalConnection(scope)),
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.test.save", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          testId: SEEDED_MEMBER_TEST_ID,
          expectedRevision: revision,
          test: seededMemberGraphTest({ includeAccidental: true, scope }),
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.test.edit", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          testId: SEEDED_MEMBER_TEST_ID,
          expectedRevision: revision,
          edits: [SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE],
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.variable.save", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          variableId: SEEDED_MEMBER_ACCOUNT_VARIABLE_ID,
          expectedRevision: revision,
          variable: seededMemberAccountVariable(scope),
        })
      ).appMap.revision;
      revision = (
        await client.invoke("app-map.combine.save", {
          appMapId: SEEDED_MEMBER_APP_MAP_ID,
          combineId: SEEDED_MEMBER_COMBINE_ID,
          expectedRevision: revision,
          combine: seededMemberCombine({
            memberProfileId: seededMemberProfileId("member"),
            scope,
          }),
        })
      ).appMap.revision;
      await client.invoke(
        "lane.save",
        seededMemberLane({ role: "member", fixture: memberFx, actorId }),
      );
      await client.invoke(
        "lane.save",
        seededMemberLane({ role: "admin", fixture: adminFx, actorId }),
      );
      await client
        .invoke("lease.create", { poolId: "local", deviceSerial: SEEDED_MEMBER_TARGET_ID })
        .catch(() => undefined);

      const failed = await runPlan(client);
      assert.match(
        failed.job.error ?? "",
        /content assertion/i,
        JSON.stringify(
          {
            error: failed.job.error,
            outcome: failed.job.outcome,
            logs: failed.job.logs?.slice(-40),
          },
          null,
          2,
        ),
      );
      assert.equal(failed.job.outcome, "product-failure");
      const failedExport = await client.invoke("job.combine.export", { batchId: failed.batchId });
      const failedHtml = await readFile(join(failedExport.rootDir, "index.html"), "utf8");
      assert.match(failedHtml, /check failed|PRODUCT_ASSERTION|content assertion/i);
      const failDir = join(durableRoot, "fail");
      await mkdir(failDir, { recursive: true });
      await cp(failedExport.rootDir, failDir, { recursive: true, force: true });

      fixture.app.setDefect(false);
      const repairDir = join(durableRoot, "repair");
      await mkdir(repairDir, { recursive: true });
      const cli = await spawnRelay(
        [
          "plan",
          "run",
          SEEDED_MEMBER_APP_MAP_ID,
          SEEDED_MEMBER_COMBINE_ID,
          "--lane",
          SEEDED_MEMBER_LANE_ID,
          "--export",
          repairDir,
          "--json",
          "--findings",
          "--budget",
          "3m",
          "--server",
          `http://127.0.0.1:${server.port}`,
          "--organization",
          organizationId,
          "--project",
          projectId,
          "--actor",
          actorId,
        ],
        {
          ...process.env,
          RELAY_STATE_DIR: root,
          RELAY_WORKSPACE_ROOT: root,
          RELAY_BROWSER_EXECUTABLE: CHROME,
          RELAY_URL: `http://127.0.0.1:${server.port}`,
          RELAY_ACTOR_ID: actorId,
          RELAY_ORGANIZATION_ID: organizationId,
          RELAY_PROJECT_ID: projectId,
        },
      );
      assert.equal(cli.status, 0, `repair CLI failed\n${cli.stderr}\n${cli.stdout}`);
      const repairedHtml = await readFile(join(repairDir, "index.html"), "utf8");
      assert.match(repairedHtml, /data-status="passed"|passed/i);
      const repairedManifest = JSON.parse(
        await readFile(join(repairDir, "manifest.json"), "utf8"),
      ) as {
        batchId?: string;
        cases?: Array<{ jobId: string; status: string }>;
      };
      const repairedJob = repairedManifest.cases?.[0];
      assert.ok(repairedJob);
      assert.equal(repairedJob.status === "ok" || repairedJob.status === "healed", true);

      const wrongAccount = await client.invoke("app-map.test.run", {
        appMapId: SEEDED_MEMBER_APP_MAP_ID,
        testId: SEEDED_MEMBER_TEST_ID,
        laneId: SEEDED_ADMIN_LANE_ID,
      });
      const adminJob = await waitForJobCompletion(wrongAccount.job.id);
      assert.match(adminJob.error ?? "", /content assertion/i);
      assert.equal(adminJob.outcome, "product-failure");

      const summary = {
        fail: { batchId: failed.batchId, jobId: failed.job.id, export: failDir },
        repair: {
          batchId: repairedManifest.batchId ?? "",
          jobId: repairedJob.jobId,
          export: repairDir,
        },
        admin: { jobId: adminJob.id, laneId: SEEDED_ADMIN_LANE_ID },
        strangerRequired: true,
      };
      await mkdir(durableRoot, { recursive: true });
      await writeFile(join(durableRoot, "last-run.json"), `${JSON.stringify(summary, null, 2)}\n`);
      process.stderr.write(`SEEDED_MEMBER_LAST_RUN=${JSON.stringify(summary)}\n`);
    } catch (error) {
      process.stderr.write(
        `SEEDED_MEMBER_LIVE_ERROR=${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      throw error;
    } finally {
      await closeBrowserTarget(SEEDED_MEMBER_TARGET_ID).catch(() => undefined);
      await closeBrowserHostPool().catch(() => undefined);
      await server?.close().catch(() => undefined);
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
      resetControlDatabaseCache();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      if (previousChrome === undefined) delete process.env.RELAY_BROWSER_EXECUTABLE;
      else process.env.RELAY_BROWSER_EXECUTABLE = previousChrome;
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function issueFixture(role: "admin" | "member", startUrl: string) {
  const issued = await fetch(new URL("/session", startUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
    redirect: "manual",
  });
  const token = /relay_session=([^;]+)/u.exec(issued.headers.get("set-cookie") ?? "")?.[1];
  if (!token) throw new Error(`fixture app did not issue a ${role} session`);
  return saveBrowserAuthenticationFixture({
    projectId,
    targetId: SEEDED_MEMBER_TARGET_ID,
    name: `${role} session`,
    createdBy: actorId,
    storageState: {
      cookies: [
        { name: "relay_session", value: token, url: startUrl, httpOnly: true, sameSite: "Lax" },
      ],
      origins: [],
    },
  });
}

async function runPlan(client: RelayClient) {
  const started = await client.invoke("job.combine.start", {
    appMapId: SEEDED_MEMBER_APP_MAP_ID,
    combineId: SEEDED_MEMBER_COMBINE_ID,
    executionMode: "all",
    laneId: SEEDED_MEMBER_LANE_ID,
  });
  const jobId = started.jobs[0]?.id;
  if (!jobId) throw new Error("Plan start did not return a job");
  const job = await waitForJobCompletion(jobId);
  const batchId = started.campaign?.id ?? started.batch.id;
  return { batchId, job };
}

function spawnRelay(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [relayBin, ...args], { cwd: repoRoot, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`relay timed out\n${stderr}\n${stdout}`));
    }, 180_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
