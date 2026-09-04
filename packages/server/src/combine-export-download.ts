import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { exportCombineEvidencePack, readCombineEvidenceBatchJobs } from "@relay/core";
import { HttpError, json } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

const defaultRuntime = { read: readCombineEvidenceBatchJobs, export: exportCombineEvidencePack };

export async function sendCombineExport({
  request,
  response,
  scope,
  batchId,
  archive,
  runtime = defaultRuntime,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  scope: RequestContext;
  batchId: string;
  archive: boolean;
  runtime?: typeof defaultRuntime;
}): Promise<void> {
  const jobs = await runtime.read(batchId);
  // Authorize the complete persisted batch, including jobs evicted from memory,
  // before generating any files or exposing paths and metadata.
  for (const job of jobs) {
    if (
      !scope.localTrusted &&
      (job.projectId !== scope.projectId || job.ownerId !== scope.subject)
    ) {
      recordAudit(scope, { action: "job.access", resource: job.id, result: "deny" });
      throw new HttpError(404, "Combine batch not found");
    }
  }
  if (!jobs.length) throw new HttpError(404, "Combine batch not found");
  const exported = await runtime.export({ batchId, jobs });
  if (!archive) {
    json(response, 200, { ...exported, jobIds: jobs.map((job) => job.id) });
    return;
  }
  const controller = new AbortController();
  const disconnect = () => {
    if (!response.writableFinished) controller.abort();
  };
  response.once("close", disconnect);
  request.once("aborted", disconnect);
  const directory = await mkdtemp(join(tmpdir(), "relay-export-"));
  try {
    const path = join(directory, "evidence.tar.gz");
    await createEvidenceArchive(exported.rootDir, path, controller.signal);
    const size = (await stat(path)).size;
    if (controller.signal.aborted) return;
    response.writeHead(200, {
      "content-type": "application/gzip",
      "content-disposition": 'attachment; filename="relay-evidence.tar.gz"',
      "content-length": size,
      "cache-control": "no-store",
    });
    await pipeline(createReadStream(path), response, { signal: controller.signal });
  } finally {
    response.off("close", disconnect);
    request.off("aborted", disconnect);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function createEvidenceArchive(
  rootDir: string,
  archivePath: string,
  signal?: AbortSignal,
): Promise<void> {
  // Never package links or special files, which could escape the export on extraction.
  async function verifyDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (entry.isDirectory()) await verifyDirectory(join(directory, entry.name));
      else if (!entry.isFile())
        throw new Error("Evidence exports must contain only files and directories.");
    }
  }
  await verifyDirectory(rootDir);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-czf", archivePath, "-C", rootDir, "."], {
      signal,
      timeout: 120_000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostic = "";
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Could not prepare evidence download: ${diagnostic.trim() || `archive process exited ${code}`}`,
          ),
        );
    });
  });
}
