import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { loadRedactionPolicy, resetControlDatabaseCache } from "@relay/core";
import { REDACTED, type RunSummary } from "@relay/protocol";
import { startServer } from "./index.js";

test("local and authenticated canonical Run lists expose retained Plan lineage without runtime inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-http-run-lineage-"));
  const keys = [
    "RELAY_STATE_DIR",
    "RELAY_RUNS_DIR",
    "RELAY_REDACTION_MODE",
    "RELAY_AUTH_PROJECT_IDS",
    "RELAY_AUTH_SUBJECT",
    "RELAY_AUTH_ROLE",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_REDACTION_MODE = "on";
  process.env.RELAY_AUTH_PROJECT_IDS = "project-a";
  process.env.RELAY_AUTH_SUBJECT = "owner-a";
  process.env.RELAY_AUTH_ROLE = "viewer";
  async function fixture(
    id: string,
    at: number,
    projectId = "project-a",
    ownerId = "owner-a",
    withLineage = true,
    companion = false,
  ) {
    const dir = join(root, "runs", id);
    await mkdir(dir, { recursive: true });
    const raw = JSON.stringify({
      schemaVersion: 5,
      id,
      dir,
      projectId,
      ownerId,
      action: withLineage ? `cell-${id}` : "app-map:grok-ios:test:fast",
      title: "Prompt checks",
      status: "error",
      attempts: 1,
      queuedAt: at,
      writtenAt: at,
      logs: [],
      steps: [],
      frames: [],
      resolvedInputs: { chat_prompt: "ordinary private runtime text" },
      inputDigest: "digest",
      batchId: "retained-batch",
      artifacts: withLineage
        ? [
            {
              kind: "app-map-combine-cell-execution-intent",
              capturedAt: at,
              data: {
                cell: { testId: "fast" },
                child: {
                  sourcePlan: { appMapId: "grok-ios", testId: companion ? "native-fast" : "fast" },
                },
                ...(companion
                  ? {
                      nativeCompanion: {
                        platform: "ios",
                        appMapId: "grok-ios",
                        testId: "native-fast",
                        requestedFrom: { appMapId: "grok-web", testId: "fast" },
                      },
                    }
                  : {}),
              },
            },
            {
              kind: "frozen-inputs",
              capturedAt: at,
              data: {
                kind: "combine-cell",
                appMapId: "grok-ios",
                testId: "fast",
                combineId: "prompt-checks",
                world: "Bearer confidential-world-token",
                values: { prompts: "value-1" },
                inputs: { chat_prompt: "ordinary private runtime text" },
              },
            },
          ]
        : [],
    });
    await writeFile(join(dir, "run.json"), raw);
    await writeFile(
      join(dir, ".complete"),
      JSON.stringify({ digest: createHash("sha256").update(raw).digest("hex") }),
    );
  }
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await fixture("owned", 2);
    await fixture("standalone", 1, "project-a", "owner-a", false);
    await fixture("other-owner", 3, "project-a", "foreign-owner");
    await fixture("other-project", 4, "foreign-project");
    await fixture("companion", 5, "project-a", "owner-a", true, true);
    const connection = {
      organizationId: "local",
      projectId: "project-a",
      actorId: "owner-a",
      actorKind: "human" as const,
    };
    server = await startServer({ host: "127.0.0.1", port: 0 });
    const local = new RelayClient({
      ...connection,
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
    });
    const localPage = await local.invoke("run.list", { appMapId: "grok-ios" });
    const retained = localPage.runs.find((run) => run.id === "owned")! as RunSummary;
    assert.equal(retained.matrixCase!.combineId, "prompt-checks");
    assert.deepEqual(retained.matrixCase!.values, { prompts: "value-1" });
    assert.ok(retained.matrixCase!.world.includes(REDACTED));
    assert.equal(JSON.stringify(localPage).includes("ordinary private runtime text"), false);
    assert.equal(localPage.runs.find((run) => run.id === "standalone")!.matrixCase, undefined);
    const localDetail = (await local.invoke("run.get", { runId: "owned" })).run as RunSummary;
    assert.deepEqual(localDetail.sourceTest, { appMapId: "grok-ios", testId: "fast" });
    assert.deepEqual(localDetail.matrixCase, retained.matrixCase);
    const localCompanion = await local.invoke("run.list", { appMapId: "grok-web" });
    assert.deepEqual(
      localCompanion.runs.map((run) => run.id),
      ["companion"],
    );
    assert.deepEqual((localCompanion.runs[0]! as RunSummary).sourceTest, {
      appMapId: "grok-web",
      testId: "fast",
    });
    assert.equal((localCompanion.runs[0]! as RunSummary).matrixCase!.appMapId, "grok-web");
    await server.close();
    server = undefined;
    const token = "run-lineage-service-token-with-32-characters";
    server = await startServer({ host: "127.0.0.1", port: 0, token });
    const authenticated = new RelayClient({
      ...connection,
      actorKind: "agent",
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "bearer", token },
    });
    const first = await authenticated.invoke("run.list", { appMapId: "grok-ios", limit: 1 });
    assert.equal(first.totalCount, 2);
    assert.equal(first.runs[0]!.id, "owned");
    assert.equal((first.runs[0]! as RunSummary).matrixCase!.combineId, "prompt-checks");
    assert.ok((first.runs[0]! as RunSummary).matrixCase!.world.includes(REDACTED));
    const second = await authenticated.invoke("run.list", {
      appMapId: "grok-ios",
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      second.runs.map((run) => run.id),
      ["standalone"],
    );
    assert.equal(second.runs[0]!.matrixCase, undefined);
    assert.equal(JSON.stringify([first, second]).includes("ordinary private runtime text"), false);
    const detail = (await authenticated.invoke("run.get", { runId: "owned" })).run as RunSummary;
    assert.deepEqual(detail.sourceTest, localDetail.sourceTest);
    assert.deepEqual(detail.matrixCase, localDetail.matrixCase);
    const companionPage = await authenticated.invoke("run.list", { appMapId: "grok-web" });
    assert.deepEqual(
      companionPage.runs.map((run) => run.id),
      ["companion"],
    );
    const companionDetail = (await authenticated.invoke("run.get", { runId: "companion" }))
      .run as RunSummary;
    assert.deepEqual(companionDetail.sourceTest, { appMapId: "grok-web", testId: "fast" });
    assert.equal(companionDetail.matrixCase!.combineId, "prompt-checks");
    assert.deepEqual(companionDetail.matrixCase, (companionPage.runs[0]! as RunSummary).matrixCase);
    assert.ok(companionDetail.matrixCase!.world.includes(REDACTED));
    for (const runId of ["other-owner", "other-project"])
      await assert.rejects(authenticated.invoke("run.get", { runId }), (error: unknown) =>
        Boolean(error && typeof error === "object" && "status" in error && error.status === 404),
      );
    const single = (await authenticated.invoke("run.get", { runId: "standalone" }))
      .run as RunSummary;
    assert.equal(single.matrixCase, undefined);
  } finally {
    await server?.close();
    resetControlDatabaseCache();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await loadRedactionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});
