import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import type http from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    totals: { runs: 7, passed: 7, problems: 0, screenshots: 70, inProgress: 0 },
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

test("share page renders proof block and failed-step drill-in", () => {
  const report: RunShareReport = {
    schemaVersion: 1,
    share: { id: "s1", title: "Proof", createdAt: 1, expiresAt: Date.now() + 60_000 },
    provenance: {
      appVersion: "3.1.0",
      platform: "ios",
      profileId: "iphone-15",
      deviceName: "iPhone 15",
      appMapRevision: 12,
      sourceRevision: { sha: "deadbeef0000", prNumber: 5 },
      startedAt: 1_000,
      completedAt: 61_000,
    },
    totals: { runs: 2, passed: 1, problems: 1, screenshots: 2, inProgress: 0 },
    runs: [
      {
        id: "run-ok",
        title: "Healthy flow",
        status: "ok",
        outcome: "passed",
        frames: [],
      },
      {
        id: "run-bad",
        title: "Broken flow",
        status: "error",
        failureCategory: "locator",
        errorHeadline: "Element not found",
        failedStep: { index: 1, total: 4, label: "Tap About phone" },
        frames: [],
      },
    ],
  };
  const html = renderRunShareReportHtml(report, "tok");
  assert.match(html, /What this proves/u);
  assert.match(html, /App version<\/dt><dd>3\.1\.0<\/dd>/u);
  assert.match(html, /ios · profile iphone-15 · iPhone 15/u);
  assert.match(html, /App Map revision<\/dt><dd>r12<\/dd>/u);
  assert.match(html, /deadbeef0000 \(PR #5\)/u);
  assert.match(
    html,
    /Failed at step 2 of 4: Tap About phone/u,
  );
});

test("share page omits proof block without provenance and adds canonical link only with base URL", () => {
  const report: RunShareReport = {
    schemaVersion: 1,
    share: { id: "s1", title: "Plain", createdAt: 1, expiresAt: Date.now() + 60_000 },
    totals: { runs: 1, passed: 0, problems: 0, screenshots: 0, inProgress: 1 },
    runs: [{ id: "r1", title: "Running", status: "running", frames: [] }],
  };
  const previous = process.env.RELAY_PUBLIC_BASE_URL;
  delete process.env.RELAY_PUBLIC_BASE_URL;
  try {
    const bare = renderRunShareReportHtml(report, "tok");
    assert.doesNotMatch(bare, /canonical|What this proves/u);
    assert.match(bare, /In progress<\/span>/u);

    process.env.RELAY_PUBLIC_BASE_URL = "https://proof.example.com";
    const absolute = renderRunShareReportHtml(report, "tok");
    assert.match(absolute, /<link rel="canonical" href="https:\/\/proof\.example\.com\/shared\/runs\/tok">/u);
  } finally {
    if (previous === undefined) delete process.env.RELAY_PUBLIC_BASE_URL;
    else process.env.RELAY_PUBLIC_BASE_URL = previous;
  }
});

test("an expired share renders a 410 tombstone page with no run data", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-public-run-share-expired-"));
  const previous = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_RUNS_DIR = root;
  try {
    await fixture(root, "english", 0);
    const created = await authenticated("/runs/english/shares", {
      expiresInHours: 1,
      includeBatch: false,
    });

    // The route classifies on Date.now(), so present a validly-signed token
    // whose embedded expiry is already in the past: exactly what an aged-out
    // capability looks like in production.
    const secret = Buffer.from(
      (await readFile(join(root, ".run-share-secret"), "utf8")).trim(),
      "base64url",
    );
    const body = Buffer.from(
      JSON.stringify({ v: 1, id: (created.json.share as { id: string }).id, exp: 1 }),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", secret).update(body).digest("base64url");
    const expiredToken = `${body}.${signature}`;

    for (const pathname of [
      `/shared/runs/${expiredToken}`,
      `/shared/runs/${expiredToken}/report`,
      `/shared/runs/${expiredToken}/frames/english/0`,
    ]) {
      const page = await publicGet(pathname);
      assert.equal(page.status, 410);
      const html = page.body.toString();
      assert.match(String(page.headers["Content-Type"]), /text\/html/u);
      assert.match(html, /This proof link has expired/u);
      assert.doesNotMatch(html, /english|Locale review|private log|Settings/u);
    }
  } finally {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
