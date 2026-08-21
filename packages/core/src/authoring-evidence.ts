import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactRefProjection, AuthoringEvidence } from "@relay/protocol";
import {
  artifactMediaKindForMime,
  artifactRefFromIntegrity,
  missingArtifactRef,
  opaqueArtifactLocation,
  projectArtifactRef,
} from "./artifact-ref.js";
import { findWorkspaceRoot } from "./workspace-root.js";

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function evidenceDirectory(): string {
  return join(stateRoot(), "authoring-evidence");
}

async function writeDurably(path: string, data: Uint8Array | string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function persistAuthoringEvidence(input: {
  kind: AuthoringEvidence["kind"];
  capturedAt: number;
  data: Uint8Array | string;
  mime?: string;
  startMs?: number;
  endMs?: number;
}): Promise<AuthoringEvidence> {
  const bytes = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : input.data;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(evidenceDirectory(), { recursive: true, mode: 0o700 });
  const destination = join(evidenceDirectory(), sha256);
  const temporary = join(evidenceDirectory(), `.${sha256}.${randomUUID()}.tmp`);
  try {
    await writeDurably(temporary, bytes);
    await link(temporary, destination);
    await syncDirectory(evidenceDirectory());
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existing = await readFile(destination);
    if (
      existing.byteLength !== bytes.byteLength ||
      createHash("sha256").update(existing).digest("hex") !== sha256
    ) {
      throw new Error(`Existing authoring evidence ${sha256} is corrupt`);
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return {
    id: `evidence-${sha256.slice(0, 24)}`,
    kind: input.kind,
    capturedAt: input.capturedAt,
    uri: `relay-evidence://${sha256}`,
    bytes: bytes.byteLength,
    sha256,
    ...(input.mime ? { mime: input.mime } : {}),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.endMs !== undefined ? { endMs: input.endMs } : {}),
  };
}

export async function authoringEvidenceExists(evidence: AuthoringEvidence): Promise<boolean> {
  const sha = evidence.uri.match(/^relay-evidence:\/\/([a-f0-9]{64})$/)?.[1];
  if (!sha || evidence.sha256 !== sha) return false;
  try {
    const bytes = await readFile(join(evidenceDirectory(), sha));
    return (
      createHash("sha256").update(bytes).digest("hex") === sha &&
      (evidence.bytes === undefined || evidence.bytes === bytes.byteLength)
    );
  } catch {
    return false;
  }
}

export async function readAuthoringEvidence(sha256: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  try {
    return await readFile(join(evidenceDirectory(), sha256));
  } catch {
    return null;
  }
}

/** Additive projection for the future provider-neutral artifact plane. The
 * returned opaque location is never a filesystem instruction; callers use
 * `readAuthoringEvidence` (or a future provider adapter) with their own
 * validated scope. */
export function projectAuthoringEvidenceArtifact(
  evidence: AuthoringEvidence,
): ArtifactRefProjection {
  const mime = evidence.mime ?? (evidence.kind === "screenshot" ? "image/png" : undefined);
  const media = {
    kind:
      evidence.kind === "snapshot"
        ? ("structured-data" as const)
        : evidence.kind === "video"
          ? ("video" as const)
          : artifactMediaKindForMime(mime),
    ...(mime ? { mime } : {}),
  };
  if (!evidence.sha256 || evidence.bytes === undefined) {
    return missingArtifactRef({
      source: "authoring-evidence",
      media,
      capturedAt: evidence.capturedAt,
    });
  }
  return projectArtifactRef(
    artifactRefFromIntegrity({
      sha256: evidence.sha256,
      bytes: evidence.bytes,
      media,
      capturedAt: evidence.capturedAt,
      provenance: { source: "authoring-evidence", capture: "recorded" },
      retention: {
        scope: "workspace-content-addressed",
        recoverability: "content-addressed",
      },
      locations: [opaqueArtifactLocation("authoring-evidence", [evidence.id, evidence.uri])],
    }),
  );
}
