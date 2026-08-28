import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { getVisualBaseline, type PersistedRun } from "@relay/core";
import { HttpError } from "./http.js";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "local",
  projectId: "project-a",
  allowedProjects: ["project-a"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

const ONE_PIXEL_PNGS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
];

class CapturedResponse {
  status = 0;
  headers: Record<string, unknown> = {};
  body = "";

  writeHead(status: number, headers: Record<string, unknown>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  end(chunk?: string | Buffer): this {
    this.body += chunk?.toString() ?? "";
    return this;
  }
}

async function persistFixture(
  root: string,
  id: string,
  frameContents: string,
  review?: PersistedRun["review"],
): Promise<PersistedRun> {
  const dir = join(root, `fixture_${id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  const frame = Buffer.from(ONE_PIXEL_PNGS[frameContents === "approved-image" ? 0 : 1]!, "base64");
  await writeFile(join(dir, "frames", "001.png"), frame);
  const run: PersistedRun = {
    schemaVersion: 5,
    id,
    projectId: "project-a",
    ownerId: "local-user",
    action: "sign-in",
    serial: "pixel-1",
    platform: "android",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    logs: [],
    steps: [],
    ...(review ? { review } : {}),
    frames: [
      {
        path: "frames/001.png",
        caption: "Home",
        capturedAt: 2,
        bytes: frame.byteLength,
        mime: "image/png",
        width: 100,
        height: 200,
      },
    ],
    dir,
    writtenAt: 2,
    artifacts: [],
    inputDigest: `digest-${id}`,
    resolvedInputs: {},
  };
  const raw = JSON.stringify(run, null, 2);
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
  return run;
}

async function requestRoute(
  method: string,
  pathname: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; value: Record<string, unknown> }> {
  const request = Readable.from([
    Buffer.from(JSON.stringify(body)),
  ]) as unknown as http.IncomingMessage;
  request.headers = {
    "content-type": "application/json",
    "x-relay-actor-id": "reviewer-1",
    "x-relay-actor-kind": "human",
  };
  const response = new CapturedResponse();
  const handled = await handleRunRoute({
    method,
    pathname,
    url: new URL(`http://localhost${pathname}`),
    request,
    response: response as unknown as http.ServerResponse,
    scope,
  });
  assert.equal(handled, true);
  return { status: response.status, value: JSON.parse(response.body) as Record<string, unknown> };
}

test("run routes compare durable visual evidence and require explicit review decisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-route-visual-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await persistFixture(root, "approved-run", "approved-image");
    await persistFixture(root, "latest-run", "changed-image");

    await assert.rejects(
      () => requestRoute("POST", "/runs/approved-run/visual-baseline"),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 400);
        assert.equal(error.body?.code, "VISUAL_REVIEW_ACTION_REQUIRED");
        return true;
      },
    );

    const approval = await requestRoute("POST", "/runs/approved-run/visual-baseline", {
      action: "approve-new-baseline",
    });
    assert.equal(approval.status, 200);
    assert.equal(
      (approval.value.decision as { resultCode: string }).resultCode,
      "VISUAL_BASELINE_APPROVED",
    );

    const compared = await requestRoute("POST", "/runs/latest-run/visual-comparison");
    const comparison = compared.value.comparison as {
      id: string;
      code: string;
      approved: { runId: string };
      latest: { runId: string };
      diff: { changedFrames: number };
    };
    assert.equal(comparison.code, "VISUAL_CHANGED");
    assert.equal(comparison.approved.runId, "approved-run");
    assert.equal(comparison.latest.runId, "latest-run");
    assert.equal(comparison.diff.changedFrames, 1);

    const initialPolicy = await requestRoute("GET", "/runs/latest-run/visual-policy");
    assert.equal((initialPolicy.value.policy as { revision: number }).revision, 0);
    const policyUpdate = await requestRoute("PUT", "/runs/latest-run/visual-policy", {
      expectedRevision: 0,
      changeThreshold: 0.0035,
      pixelThreshold: 16,
      regions: [
        {
          id: "dynamic-content",
          name: "Dynamic content",
          mode: "ignore",
          frameIndex: 0,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
      ],
    });
    assert.equal((policyUpdate.value.policy as { revision: number }).revision, 1);
    assert.equal(
      (policyUpdate.value.comparison as { code: string }).code,
      "VISUAL_MATCH",
      "a reviewed ignore region changes comparison semantics without replacing the baseline",
    );

    const kept = await requestRoute("POST", "/runs/latest-run/visual-review", {
      comparisonId: comparison.id,
      action: "keep-baseline",
      note: "The product change is not ready.",
    });
    assert.equal(
      (kept.value.decision as { resultCode: string; actor: { id: string } }).resultCode,
      "VISUAL_BASELINE_KEPT",
    );
    assert.equal((kept.value.decision as { actor: { id: string } }).actor.id, "reviewer-1");
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "approved-run",
    );

    const promoted = await requestRoute("POST", "/runs/latest-run/visual-review", {
      comparisonId: comparison.id,
      action: "approve-new-baseline",
    });
    assert.equal(
      (promoted.value.decision as { resultCode: string }).resultCode,
      "VISUAL_BASELINE_APPROVED",
    );
    assert.equal(
      (await getVisualBaseline(root, "sign-in", "pixel-1", "project-a"))?.runId,
      "latest-run",
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("run routes expose deferred checks and persist the human decision", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-route-review-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await persistFixture(root, "review-run", "approved-image", {
      schemaVersion: 1,
      status: "pending",
      capability: "camera attachment",
      reason: "The captured image needs a human comparison.",
      requestedAt: 2,
      requestedBy: { id: "agent:openrouter", kind: "agent" },
    });

    const before = await requestRoute("GET", "/runs");
    assert.equal(
      (before.value.runs as Array<{ review?: { status: string } }>).find(
        (run) => run.review?.status === "pending",
      )?.review?.status,
      "pending",
    );

    const deferred = await requestRoute("POST", "/runs/review-run/review", {
      action: "defer",
      note: "Ask the localization owner.",
    });
    assert.equal((deferred.value.review as { status: string }).status, "pending");
    assert.equal((deferred.value.review as { note: string }).note, "Ask the localization owner.");

    const approved = await requestRoute("POST", "/runs/review-run/review", {
      action: "approve",
      note: "The image is correct.",
    });
    assert.equal((approved.value.review as { status: string }).status, "approved");
    assert.equal((approved.value.run as { outcome: string }).outcome, "passed");

    await assert.rejects(
      () => requestRoute("POST", "/runs/review-run/review", { action: "reject" }),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 409);
        assert.equal(error.body?.code, "RUN_REVIEW_CONFLICT");
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
