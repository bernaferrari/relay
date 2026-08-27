import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { PersistedRun } from "@relay/core";
import { HttpError } from "./http.js";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const at = 1_787_175_782_645;

const scope: RequestContext = {
  subject: "owner-1",
  organizationId: "org-1",
  projectId: "project-1",
  allowedProjects: ["project-1"],
  tokenKind: "local",
  localTrusted: false,
  role: "viewer",
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

function offlineReplayFixture(dir: string): PersistedRun {
  return {
    schemaVersion: 5,
    id: "offline-run-1",
    projectId: "project-1",
    ownerId: "owner-1",
    action: "app-map:settings:test:relay-40",
    status: "error",
    attempts: 1,
    queuedAt: at,
    logs: [],
    steps: [],
    frames: [],
    dir,
    writtenAt: at + 20,
    inputDigest: "f".repeat(64),
    resolvedInputs: {},
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: at,
        data: {
          schemaVersion: 1,
          appMapId: "settings",
          appMapRevision: 7,
          test: { id: "relay-40", name: "Relay 40" },
        },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: at + 1,
        data: { checkId: "visit-settings", status: "verified" },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at + 2,
        data: { id: "visit-settings", title: "Visit Settings", status: "passed" },
      },
      {
        kind: "navigation-proof-cursor",
        capturedAt: at + 3,
        data: { schemaVersion: 1, status: "proven", screenId: "settings" },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: at + 4,
        data: {
          checkId: "visit-birth-year",
          attempts: [
            {
              kind: "target-resolution",
              data: { strategy: "label", target: { label: "Birth year" } },
            },
          ],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at + 5,
        data: {
          id: "visit-birth-year",
          title: "Visit Birth year",
          status: "failed",
          warmSourceScreenId: "settings",
          error: "expect-screen: on Settings, not Birth Year",
        },
      },
    ],
  };
}

async function persistFixture(root: string): Promise<void> {
  const dir = join(root, "offline-run-1");
  await mkdir(dir, { recursive: true });
  const raw = JSON.stringify(offlineReplayFixture(dir), null, 2);
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id: "offline-run-1",
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
}

async function get(
  pathname: string,
  requestScope: RequestContext = scope,
): Promise<{ response: CapturedResponse; body: Record<string, unknown> }> {
  const request = Readable.from([]) as unknown as http.IncomingMessage;
  request.headers = {};
  const response = new CapturedResponse();
  const handled = await handleRunRoute({
    method: "GET",
    pathname,
    url: new URL(`http://localhost${pathname}`),
    request,
    response: response as unknown as http.ServerResponse,
    scope: requestScope,
  });
  assert.equal(handled, true);
  return { response, body: JSON.parse(response.body) as Record<string, unknown> };
}

test("offline replay route diagnoses persisted evidence without a target and enforces run access", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-offline-replay-route-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await persistFixture(root);
    const { response, body } = await get("/runs/offline-run-1/replay-offline");
    assert.equal(response.status, 200);
    const report = body.report as {
      mode: string;
      runId: string;
      summary: { checks: number; proved: number; rootFailures: number };
      firstRootFailure?: { checkId: string; kind: string };
    };
    assert.equal(report.mode, "offline-evidence-replay");
    assert.equal(report.runId, "offline-run-1");
    assert.deepEqual(report.summary, {
      checks: 2,
      proved: 1,
      rootFailures: 1,
      invalidCascades: 0,
      independentFailures: 0,
    });
    assert.deepEqual(report.firstRootFailure, {
      checkId: "visit-birth-year",
      title: "Visit Birth year",
      kind: "action-no-op",
      error: "expect-screen: on Settings, not Birth Year",
      evidence: ["run:offline-run-1#artifact:4", "run:offline-run-1#artifact:5"],
    });

    await assert.rejects(
      () => get("/runs/offline-run-1/replay-offline", { ...scope, subject: "another-user" }),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("TracePack route exports and analyzes only the scoped persisted run", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-trace-pack-route-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await persistFixture(root);
    const { response, body } = await get("/runs/offline-run-1/trace-pack");
    assert.equal(response.status, 200);
    const tracePack = body.tracePack as {
      kind: string;
      source: { runId: string };
      digest: string;
    };
    const analysis = body.analysis as {
      futureTransitionVerdict: string;
      smallestLiveVerification: { kind: string; checkId?: string };
    };
    assert.equal(tracePack.kind, "relay-trace-pack");
    assert.equal(tracePack.source.runId, "offline-run-1");
    assert.match(tracePack.digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(analysis.futureTransitionVerdict, "unknown");
    assert.deepEqual(analysis.smallestLiveVerification, {
      kind: "replay-check",
      checkId: "visit-birth-year",
      reason: "Visit Birth year is the first causal failure; replay only this check first.",
      requiresTarget: true,
    });

    await assert.rejects(
      () => get("/runs/offline-run-1/trace-pack", { ...scope, subject: "another-user" }),
      (error: unknown) => error instanceof HttpError && error.status === 404,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
