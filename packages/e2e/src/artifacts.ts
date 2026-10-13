import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Report } from "e2e";

export type Artifact = Report["run"]["results"][number]["attempts"][number]["artifacts"][number];
export type ImportedArtifact = {
  ownerKind: string;
  ownerId: string;
  attemptId: string;
  attemptIndex: number;
  source: Artifact;
  state: "available" | "missing" | "external" | "denied";
  path?: string;
  sha256?: string;
  size?: number;
  reason?: string;
};
const within = (root: string, file: string) => {
  const part = relative(root, file);
  return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
};

export async function copyArtifact(
  artifact: Artifact,
  root: string,
  destination: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Pick<ImportedArtifact, "state" | "path" | "sha256" | "size" | "reason">> {
  if (artifact.redaction !== "complete") return { state: "denied", reason: "redaction-incomplete" };
  if (!artifact.path)
    return {
      state: artifact.url ? "external" : "missing",
      reason: artifact.url ? "remote-artifact-not-imported" : "no-local-path",
    };
  if (
    isAbsolute(artifact.path) ||
    artifact.path.includes("\\") ||
    !within(root, resolve(root, artifact.path))
  )
    return { state: "denied", reason: "path-outside-artifacts-root" };
  const temporary = resolve(destination, "artifacts", `.import-${randomUUID()}`);
  try {
    signal.throwIfAborted();
    const canonicalRoot = await realpath(root);
    const source = await realpath(resolve(root, artifact.path));
    if (!within(canonicalRoot, source))
      return { state: "denied", reason: "symlink-outside-artifacts-root" };
    await mkdir(resolve(destination, "artifacts"), { recursive: true });
    const hash = createHash("sha256");
    let size = 0;
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(new Error("artifact-size-limit"));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(source),
      measure,
      createWriteStream(temporary, { flags: "wx" }),
      { signal },
    );
    const sha256 = hash.digest("hex");
    if (artifact.sha256 && artifact.sha256 !== sha256) throw new Error("artifact-hash-mismatch");
    if (artifact.size !== undefined && artifact.size !== size)
      throw new Error("artifact-size-mismatch");
    const path = `artifacts/${sha256}`;
    await rename(temporary, resolve(destination, path));
    return { state: "available", path, sha256, size };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    return {
      state: "missing",
      reason: error instanceof Error ? error.message : "artifact-import-failed",
    };
  } finally {
    await rm(temporary, { force: true });
  }
}
