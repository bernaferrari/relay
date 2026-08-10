import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { PersistedRun } from "@relay/core";
import type { RunShareReport } from "@relay/protocol";
import { handlePublicRunShareRoute, renderRunShareReportHtml } from "./run-share-routes.js";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=",
  "base64",
);
const scope: RequestContext = {
  subject: "owner-1",
  organizationId: "org-1",
  projectId: "project-1",
  allowedProjects: ["project-1"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

class CapturedResponse {
  status = 0;
  headers: Record<string, unknown> = {};
  body = Buffer.alloc(0);
  setHeader(name: string, value: unknown): void {
    this.headers[name] = value;
  }
  writeHead(status: number, headers: Record<string, unknown> = {}): this {
    this.status = status;
    Object.assign(this.headers, headers);
    return this;
  }
  end(chunk?: string | Buffer): this {
    if (chunk) this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
    return this;
  }
}

async function fixture(root: string, id: string, caseIndex: number): Promise<void> {
  const dir = join(root, `run_${id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  await writeFile(join(dir, "frames", "001.png"), PNG);
  const run: PersistedRun = {
    schemaVersion: 5,
    id,
    projectId: "project-1",
    ownerId: "owner-1",
    action: "settings-tour",
    title: "Locale review",
    serial: "private-device-id",
    platform: "android",
    status: "ok",
    outcome: "passed",
    attempts: 1,
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    durationMs: 1,
    logs: ["private log"],
    steps: [],
    frames: [
      {
        path: "frames/001.png",
        caption: "Settings",
        capturedAt: 2,
        bytes: PNG.byteLength,
        mime: "image/png",
        width: 1,
        height: 1,
      },
    ],
    dir,
    writtenAt: 2 + caseIndex,
    artifacts: [],
    inputDigest: `digest-${id}`,
    resolvedInputs: { language: caseIndex ? "Italian" : "English" },
    batchId: "batch-1",
    caseIndex,
    caseCount: 2,
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
}

async function authenticated(pathname: string, body: Record<string, unknown>) {
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
    method: "POST",
    pathname,
    url: new URL(`http://localhost${pathname}`),
    request,
    response: response as unknown as http.ServerResponse,
    scope,
  });
  assert.equal(handled, true);
  return { response, json: JSON.parse(response.body.toString()) as Record<string, unknown> };
}

async function publicGet(pathname: string): Promise<CapturedResponse> {
  const response = new CapturedResponse();
  assert.equal(
    await handlePublicRunShareRoute({
      method: "GET",
      pathname,
      response: response as unknown as http.ServerResponse,
    }),
    true,
  );
  return response;
}

test("signed report links expose only grouped public evidence and stop working when revoked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-public-run-share-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await fixture(root, "english", 0);
    await fixture(root, "italian", 1);
    const created = await authenticated("/runs/english/shares", {
      expiresInHours: 24,
      includeBatch: true,
    });
    assert.equal(created.response.status, 201);
    const token = created.json.token as string;
    const share = created.json.share as { id: string; runCount: number };
    assert.equal(share.runCount, 2);

    const page = await publicGet(`/shared/runs/${token}`);
    const html = page.body.toString();
    assert.equal(page.status, 200);
    assert.match(String(page.headers["Content-Security-Policy"]), /default-src 'none'/u);
    assert.match(html, /Grouped by screen across every run/u);
    assert.match(html, /2 variants/u);
    assert.match(html, /Inputs and device identifiers are hidden/u);
    assert.doesNotMatch(html, /private-device-id|private log|Italian|English/u);

    const report = await publicGet(`/shared/runs/${token}/report`);
    const reportJson = report.body.toString();
    assert.match(reportJson, /"screenshots":2/u);
    assert.doesNotMatch(reportJson, /resolvedInputs|private-device-id|private log/u);

    const image = await publicGet(`/shared/runs/${token}/frames/italian/0`);
    assert.deepEqual(image.body, PNG);

    await authenticated(`/runs/english/shares/${share.id}/revoke`, {});
    const revoked = await publicGet(`/shared/runs/${token}`);
    assert.equal(revoked.status, 404);
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a seventy-screenshot matrix renders as ten screen groups with deferred images", () => {
  const report: RunShareReport = {
    schemaVersion: 1,
    share: {
      id: "share-1",
      title: "Locales × settings",
      createdAt: 1,
      expiresAt: Date.now() + 1_000,
    },
    totals: { runs: 7, passed: 7, problems: 0, screenshots: 70 },
    runs: Array.from({ length: 7 }, (_, caseIndex) => ({
      id: `run-${caseIndex}`,
      title: `Locale ${caseIndex + 1}`,
      status: "ok",
      outcome: "passed" as const,
      caseIndex,
      caseCount: 7,
      frames: Array.from({ length: 10 }, (_, index) => ({
        index,
        caption: `Settings ${index + 1}`,
        capturedAt: index,
      })),
    })),
  };
  const html = renderRunShareReportHtml(report, "token");
  assert.equal(html.match(/<details class="screen"/gu)?.length, 10);
  assert.equal(html.match(/<details class="screen" open/gu)?.length, 2);
  assert.equal(html.match(/<img /gu)?.length, 70);
  assert.equal(html.match(/loading="lazy"/gu)?.length, 70);
  assert.match(html, /70<\/strong><span>Screenshots/u);
});
