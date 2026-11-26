import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  findWorkspaceRoot,
  readPersistedRun,
  captureReviewQueueForRun,
  reviewPersistedCapture,
  runsRoot,
  exportTracePack,
  replayInputFromPersistedRun,
  buildRunVerdict,
} from "@relay/core";
import { createE2EProjectService } from "./e2e-project-service.js";

const wait = async (service: ReturnType<typeof createE2EProjectService>, id: string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const execution = await service.execution(id);
    if (!["running", "importing"].includes(execution.status)) return execution;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Upstream execution did not finish");
};

test(
  "trusted upstream project runs unchanged, retains review after restart, repairs, and recovers without actions",
  { timeout: 90_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "relay-e2e-project-"));
    const path = join(dir, "project"),
      state = join(dir, "state");
    let defect = true,
      actions = 0;
    const app = createServer((_req, res) => {
      actions++;
      res.setHeader("content-type", "text/html");
      res.end(
        `<h1>Account settings</h1><p role="status">${defect ? "broken" : "ready"}</p><button onclick="setTimeout(()=>document.querySelector('[role=status]').textContent='saved',200)">Save</button>`,
      );
    });
    await new Promise<void>((done) => app.listen(0, "127.0.0.1", done));
    try {
      const address = app.address();
      assert(address && typeof address !== "string");
      await mkdir(join(path, "tests"), { recursive: true });
      await symlink(
        resolve(findWorkspaceRoot(), "packages/e2e/node_modules"),
        join(path, "node_modules"),
        "dir",
      );
      await writeFile(join(path, "package.json"), JSON.stringify({ type: "module" }));
      const source = `import {test,expect} from 'e2e';
test('settings',async({app,screen})=>{await app.open();await app.screenshot('Settings');await expect(screen.getByRole('status')).toContainText('ready')});
test('delayed save',async({app,screen})=>{await app.open();await screen.getByRole('button',{name:'Save'}).click();await expect(screen.getByRole('status')).toContainText('saved');await app.screenshot('Saved')});`;
      await writeFile(join(path, "tests/settings.e2e.ts"), source);
      await writeFile(
        join(path, "e2e.config.ts"),
        `import {web} from '@e2e-dev/web';export default {targets:[{name:'web',engine:web(),app:{url:'http://127.0.0.1:${address.port}'}}],tests:'tests/*.e2e.ts',workers:1,cache:'off',assertionTimeout:700,reporters:['json']}`,
      );
      await writeFile(
        join(path, "relay.evidence.json"),
        JSON.stringify({
          obligations: [
            {
              id: "settings",
              testId: "tests/settings.e2e.ts::settings",
              targetId: "web",
              stepLabel: "Settings",
            },
            {
              id: "saved",
              testId: "tests/settings.e2e.ts::delayed%20save",
              targetId: "web",
              stepLabel: "Saved",
            },
            {
              id: "missing",
              testId: "tests/settings.e2e.ts::settings",
              targetId: "web",
              stepLabel: "Missing",
            },
          ],
        }),
      );
      const service = createE2EProjectService(state),
        scope = { projectId: "local", ownerId: "local-human" };
      await assert.rejects(service.open(path, "untrusted"), /trust/i);
      const project = await service.open(path, "trusted-project");
      assert.equal(project.tests.length, 2);
      assert.equal((await service.source(project.id, project.tests[0]!.file)).text, source);
      await assert.rejects(service.source(project.id, "../package.json"), /Source/);
      const admissions = await Promise.allSettled([
        service.run(project.id, undefined, scope),
        service.run(project.id, undefined, scope),
      ]);
      assert.equal(
        admissions.filter((result) => result.status === "fulfilled").length,
        1,
        "simultaneous requests admit only one upstream execution",
      );
      const admitted = admissions.find((result) => result.status === "fulfilled");
      assert(admitted?.status === "fulfilled");
      const started = admitted.value;
      const first = await wait(service, started.id);
      assert.equal(first.upstreamStatus, "failed", JSON.stringify(first));
      assert.equal(first.status, "import-incomplete");
      assert.equal(first.requiredCaptures, 3);
      assert.equal(first.availableCaptures, 2);
      assert.equal(first.pendingReview, 2);
      assert.equal(first.runIds.length, 2);
      const run = await readPersistedRun(first.runIds[0]!);
      assert(run);
      const verdict = buildRunVerdict(run);
      assert.equal(verdict.status, "failed");
      assert(verdict.steps.some((step) => step.status === "failed"));
      assert.equal(run.evidence?.channels.screenshot.entries, run.frames.length);
      assert.equal(run.frames[0]?.mime, "image/png");
      assert.throws(() => replayInputFromPersistedRun(run), /e2e project/);
      const queue = captureReviewQueueForRun(run);
      const image = queue.items.find((item) => item.framePath);
      assert(image);
      // A fixture human explicitly reviews the retained image. Agents cannot approve it.
      await assert.rejects(
        reviewPersistedCapture(runsRoot(), run, {
          captureId: image.captureId,
          action: "accept",
          actor: { id: "agent", kind: "agent" },
        }),
        /human/i,
      );
      await reviewPersistedCapture(runsRoot(), run, {
        captureId: image.captureId,
        action: "accept",
        actor: { id: "reviewer-fixture", kind: "human" },
        imageSha256: image.imageSha256,
      });
      const restarted = createE2EProjectService(state);
      assert.equal((await restarted.execution(first.id)).accepted, 1);
      const actionCount = actions;
      const executionRecord = JSON.parse(
        await readFile(join(state, "executions", first.id, "execution.json"), "utf8"),
      );
      const importedDirectories = await import("node:fs/promises").then((fs) =>
        fs.readdir(executionRecord.evidence),
      );
      const evidenceDirectory = join(
        executionRecord.evidence,
        importedDirectories.find((id) => /^[a-f0-9]{64}$/.test(id))!,
      );
      await rm(join(evidenceDirectory, "artifacts"), { recursive: true, force: true });
      await restarted.retryImport(first.id, scope);
      assert.equal(actions, actionCount, "recovery must not execute any app actions");
      assert.equal((await restarted.execution(first.id)).accepted, 1);
      await rm(executionRecord.output, { recursive: true, force: true });
      await restarted.retryImport(first.id, scope);
      assert.equal(actions, actionCount, "retained-report recovery must also avoid app actions");
      assert.equal((await restarted.execution(first.id)).accepted, 1);
      await assert.rejects(
        restarted.retryImport(first.id, { projectId: "other", ownerId: "other" }),
        /workspace/,
      );
      const persisted = await readPersistedRun(run.id);
      assert(persisted);
      const pack = await exportTracePack(persisted);
      assert(
        pack.objects.some((object) => object.path === "files/provenance/upstream-report.json"),
        "shared evidence includes the original report",
      );
      defect = false;
      const repaired = await wait(
        restarted,
        (await restarted.run(project.id, undefined, scope)).id,
      );
      assert.equal(repaired.upstreamStatus, "passed");
      assert.equal(
        repaired.status,
        "import-incomplete",
        "a missing checkpoint remains missing after execution passes",
      );
      assert.equal(
        await readFile(join(path, "tests/settings.e2e.ts"), "utf8"),
        source,
        "repair keeps the criterion unchanged",
      );
      const hash = createHash("sha256").update(source).digest("hex");
      console.log(
        JSON.stringify({
          sourceSha256: hash,
          failed: first.upstreamStatus,
          repaired: repaired.upstreamStatus,
          required: 3,
          available: 2,
          reviewSurvivedRestart: true,
          recoveredWithoutActions: true,
        }),
      );
    } finally {
      await new Promise<void>((done, reject) =>
        app.close((error) => (error ? reject(error) : done())),
      );
      await rm(dir, { recursive: true, force: true });
    }
  },
);
