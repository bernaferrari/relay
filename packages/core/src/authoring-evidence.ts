import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthoringEvidence } from "@relay/protocol";
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
  try {
    await writeDurably(destination, bytes);
    await syncDirectory(evidenceDirectory());
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
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
