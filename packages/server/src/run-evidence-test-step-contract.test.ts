import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { PersistedRun } from "@relay/core";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "local",
  projectId: "local",
  allowedProjects: ["local"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

class CapturedResponse {
  status = 0;
  body = "";

  writeHead(status: number): this {
    this.status = status;
    return this;
  }

  end(chunk?: string | Buffer): this {
    this.body += chunk?.toString() ?? "";
    return this;
  }
}

test("run evidence exposes stable authored-step joins and keeps old Runs readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-evidence-step-route-"));
  const dir = join(root, "run-with-step-evidence");
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  const run: PersistedRun = {
    schemaVersion: 4,
    id: "run-with-step-evidence",
    projectId: "local",
    ownerId: "local-user",
    action: "test.run",
    platform: "android",
    serial: "emulator-5554",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    logs: [],
    steps: [],
    frames: [],
    dir,
    writtenAt: 2,
    testStepEvidence: [
      {
        schemaVersion: 1,
        testStepId: "authored-a",
        recipeId: "test:root",
        recipeStepId: "recipe-a",
        traceStepId: "trace-a",
        traceStepIndex: 0,
        occurrence: 1,
        evidence: { framePaths: ["frames/a.png"], eventSequences: [1], artifactKinds: [] },
      },
      {
        schemaVersion: 1,
        testStepId: "authored-b",
        recipeId: "test:root",
        recipeStepId: "recipe-b",
        traceStepId: "trace-b",
        traceStepIndex: 1,
        occurrence: 1,
        evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
      },
    ],
    artifacts: [],
    inputDigest: "a".repeat(64),
    resolvedInputs: {},
  };
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(run));
    const request = Readable.from([]) as unknown as http.IncomingMessage;
    request.headers = {};
    const response = new CapturedResponse();
    await handleRunRoute({
      method: "GET",
      pathname: "/runs/run-with-step-evidence/evidence",
      url: new URL("http://localhost/runs/run-with-step-evidence/evidence?testStepId=authored-b"),
      request,
      response: response as unknown as http.ServerResponse,
      scope,
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body) as {
      evidence: { testStepEvidence: Array<{ testStepId: string }> };
    };
    assert.deepEqual(body.evidence.testStepEvidence, [
      {
        schemaVersion: 1,
        testStepId: "authored-b",
        recipeId: "test:root",
        recipeStepId: "recipe-b",
        traceStepId: "trace-b",
        traceStepIndex: 1,
        occurrence: 1,
        evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
      },
    ]);

    const legacy = { ...run, id: "legacy-run", dir: join(root, "legacy-run") };
    await mkdir(legacy.dir, { recursive: true });
    delete (legacy as Partial<PersistedRun>).testStepEvidence;
    await writeFile(join(legacy.dir, "run.json"), JSON.stringify(legacy));
    const legacyResponse = new CapturedResponse();
    await handleRunRoute({
      method: "GET",
      pathname: "/runs/legacy-run/evidence",
      url: new URL("http://localhost/runs/legacy-run/evidence"),
      request: Readable.from([]) as unknown as http.IncomingMessage,
      response: legacyResponse as unknown as http.ServerResponse,
      scope,
    });
    assert.equal(legacyResponse.status, 200);
    assert.deepEqual(
      (JSON.parse(legacyResponse.body) as { evidence: { testStepEvidence: unknown[] } }).evidence
        .testStepEvidence,
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
