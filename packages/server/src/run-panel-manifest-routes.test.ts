import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "owner",
  organizationId: "org",
  projectId: "project",
  allowedProjects: ["project"],
  tokenKind: "external",
  localTrusted: false,
  role: "viewer",
};
class Response {
  status = 0;
  body = "";
  writeHead(status: number) {
    this.status = status;
    return this;
  }
  end(value?: string | Buffer) {
    this.body += value?.toString() ?? "";
    return this;
  }
  setHeader() {}
}
async function call(path: string, requestScope = scope) {
  const url = new URL(path, "http://localhost");
  const response = new Response();
  await handleRunRoute({
    method: "GET",
    pathname: url.pathname,
    url,
    request: Readable.from([]) as http.IncomingMessage,
    response: response as unknown as http.ServerResponse,
    scope: requestScope,
  });
  return { status: response.status, data: JSON.parse(response.body) };
}
test("retained manifest is paginated, metadata-only and protected by the existing Run owner scope", async (t) => {
  const previous = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-panel-route-"));
  process.env.RELAY_RUNS_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const dir = join(root, "run_manifest-run");
  await mkdir(dir, { recursive: true });
  const raw = JSON.stringify({
    schemaVersion: 5,
    id: "manifest-run",
    projectId: "project",
    ownerId: "owner",
    action: "checkout",
    status: "ok",
    outcome: "passed",
    queuedAt: 1,
    attempts: 1,
    dir,
    steps: [],
    frames: [],
    artifacts: Array.from({ length: 50 }, (_, index) => ({
      kind: "capture-review",
      capturedAt: index,
      data: {
        caption: `Screenshot ${index}`,
        framePath: `frames/${index}.png`,
        imageSha256: "a".repeat(64),
        configuration: { account: "member" },
      },
    })),
  });
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id: "manifest-run",
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
  const first = await call("/runs/manifest-run/panel-manifest");
  assert.equal(first.status, 200);
  assert.equal(first.data.manifest.frames.items.length, 40);
  assert.equal(first.data.manifest.frames.nextOffset, 40);
  assert.equal(first.data.manifest.coverage.planned, 50);
  const next = await call("/runs/manifest-run/panel-manifest?offset=40&limit=1");
  assert.equal(next.data.manifest.frames.items.length, 1);
  assert.equal(next.data.manifest.frames.items[0].index, 40);
  assert.equal(next.data.manifest.frames.items[0].file, "40.png");
  assert.equal(next.data.manifest.frames.items[0].configuration.account, "member");
  assert.doesNotMatch(JSON.stringify(next), /base64|content|run_manifest-run/);
  await assert.rejects(
    call("/runs/manifest-run/panel-manifest", { ...scope, subject: "another-owner" }),
    /Run not found/,
  );
  await assert.rejects(
    call("/runs/manifest-run/panel-manifest", { ...scope, projectId: "another-project" }),
    /Run not found/,
  );
  await mkdir(join(dir, "frames"));
  await writeFile(join(dir, "frames", "oversized.png"), Buffer.alloc(2_000_001));
  await assert.rejects(
    call("/runs/manifest-run/frames/oversized.png?maxBytes=2000000"),
    /requested display limit/,
  );
  await assert.rejects(
    call("/runs/manifest-run/frames/oversized.png?maxBytes=2000000", {
      ...scope,
      subject: "another-owner",
    }),
    /Run not found/,
  );
});
