import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { CombineEvidenceCase } from "@relay/core";
import { createEvidenceArchive, sendCombineExport } from "./combine-export-download.js";
import type { RequestContext } from "./security.js";

const execFileAsync = promisify(execFile);

function job(overrides: Partial<CombineEvidenceCase> = {}): CombineEvidenceCase {
  return {
    id: "job-1",
    projectId: "project-a",
    ownerId: "owner-a",
    action: "combine.run",
    batchId: "batch-1",
    caseIndex: 0,
    artifacts: [],
    frames: [{ path: "frames/001.png", caption: "Home", capturedAt: 1 }],
    steps: [],
    resolvedInputs: { locale: "en" },
    recipeId: "recipe-1",
    runDir: undefined,
    status: "ok",
    ...overrides,
  };
}

function scope(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    subject: "owner-a",
    organizationId: "org-a",
    projectId: "project-a",
    allowedProjects: ["project-a"],
    tokenKind: "service",
    localTrusted: false,
    role: "admin",
    ...overrides,
  };
}

test("createEvidenceArchive packages screenshots and persisted frame trees", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-export-test-"));
  const source = join(root, "source");
  const archive = join(root, "evidence.tar.gz");
  await mkdir(join(source, "frames"), { recursive: true });
  await writeFile(join(source, "frames/001.png"), "png-bytes");
  await writeFile(
    join(source, "frames/001.json"),
    JSON.stringify({ schemaVersion: 1, kind: "relay.frame-tree", nodes: [{ label: "Home" }] }),
  );
  try {
    await createEvidenceArchive(source, archive);
    const listing = (await execFileAsync("tar", ["-tzf", archive])).stdout;
    assert.match(listing, /frames\/001\.png/);
    assert.match(listing, /frames\/001\.json/);
    const archiveStat = await readFile(archive);
    assert.ok(archiveStat.byteLength > 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive creation rejects symlinks before tar can follow them", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-export-link-"));
  const source = join(root, "source");
  try {
    await mkdir(source, { recursive: true });
    await symlink("/etc/passwd", join(source, "escape.txt"));
    await assert.rejects(() => createEvidenceArchive(source, join(root, "out.tar.gz")), {
      message: "Evidence exports must contain only files and directories.",
    });
    assert.equal(await readlink(join(source, "escape.txt")), "/etc/passwd");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("foreign persisted cases are rejected before export runtime is called", async () => {
  const request = new EventEmitter();
  const response = new EventEmitter();
  let exported = false;
  const runtime = {
    read: async () => [job(), job({ id: "job-foreign", ownerId: "other-owner" })],
    export: async () => {
      exported = true;
      throw new Error("must not export");
    },
  };
  await assert.rejects(
    () =>
      sendCombineExport({
        request: request as never,
        response: response as never,
        scope: scope(),
        batchId: "batch-1",
        archive: true,
        runtime,
      }),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 404);
      return true;
    },
  );
  assert.equal(exported, false);
});

test("foreign project cases are rejected even when owner matches", async () => {
  const request = new EventEmitter();
  const response = new EventEmitter();
  let exported = false;
  await assert.rejects(
    () =>
      sendCombineExport({
        request: request as never,
        response: response as never,
        scope: scope(),
        batchId: "batch-1",
        archive: false,
        runtime: {
          read: async () => [job({ projectId: "project-other" })],
          export: async () => {
            exported = true;
            return { rootDir: "/tmp/never", manifest: {} as never };
          },
        },
      }),
    (error: unknown) => (error as { status?: number }).status === 404,
  );
  assert.equal(exported, false);
});

test("archive download streams a real tar with download headers and cleans its staging directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-export-http-"));
  const evidence = join(root, "evidence");
  await mkdir(join(evidence, "frames"), { recursive: true });
  await writeFile(join(evidence, "frames/001.png"), "png-bytes");
  await writeFile(
    join(evidence, "frames/001.json"),
    JSON.stringify({ schemaVersion: 1, kind: "relay.frame-tree", nodes: [{ label: "Home" }] }),
  );
  const request = new EventEmitter();
  const stagingBefore = new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith("relay-export-")),
  );
  const response = new PassThrough() as PassThrough & {
    statusCode?: number;
    headers?: Record<string, string | number>;
    writeHead?: (status: number, headers: Record<string, string | number>) => void;
  };
  response.writeHead = (status, headers) => {
    response.statusCode = status;
    response.headers = headers;
  };
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  try {
    await sendCombineExport({
      request: request as never,
      response: response as never,
      scope: scope(),
      batchId: "batch-1",
      archive: true,
      runtime: {
        read: async () => [job()],
        export: async () => ({ rootDir: evidence, manifest: {} as never }),
      },
    });
    const body = Buffer.concat(chunks);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers?.["content-type"], "application/gzip");
    assert.equal(
      response.headers?.["content-disposition"],
      'attachment; filename="relay-evidence.tar.gz"',
    );
    assert.equal(Number(response.headers?.["content-length"]), body.byteLength);
    const archive = join(root, "download.tar.gz");
    await writeFile(archive, body);
    const listing = (await execFileAsync("tar", ["-tzf", archive])).stdout;
    assert.match(listing, /frames\/001\.png/);
    assert.match(listing, /frames\/001\.json/);
    const stagingAfter = (await readdir(tmpdir())).filter((name) =>
      name.startsWith("relay-export-"),
    );
    assert.deepEqual(
      stagingAfter.filter((name) => !stagingBefore.has(name)),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
