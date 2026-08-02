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
};

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
): Promise<PersistedRun> {
  const dir = join(root, `fixture_${id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  const frame = Buffer.concat([ONE_PIXEL_PNG, Buffer.from(frameContents)]);
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
