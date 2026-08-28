import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AuthoringSession } from "@relay/protocol";
import { authoringCaptureProvenance, serializeAuthoringSession } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

function sessionsRoot(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "authoring-sessions");
}

function safeSessionId(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error("Invalid Authoring Session id");
  return value;
}

export function authoringSessionPath(id: string): string {
  return join(sessionsRoot(), `${safeSessionId(id)}.json`);
}

export async function writeAuthoringSession(session: AuthoringSession): Promise<void> {
  await mkdir(sessionsRoot(), { recursive: true, mode: 0o700 });
  const destination = authoringSessionPath(session.id);
  const staged = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(serializeAuthoringSession(session));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staged, destination);
    const directory = await open(sessionsRoot(), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(staged).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}

function parseAuthoringSession(value: unknown): AuthoringSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<AuthoringSession>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    typeof input.projectId !== "string" ||
    typeof input.actorId !== "string" ||
    typeof input.state !== "string" ||
    !input.target ||
    typeof input.leaseId !== "string"
  )
    return null;
  return {
    ...(input as AuthoringSession),
    captureProvenance: authoringCaptureProvenance(input.captureProvenance),
  };
}

export async function readAuthoringSession(id: string): Promise<AuthoringSession | null> {
  try {
    return parseAuthoringSession(JSON.parse(await readFile(authoringSessionPath(id), "utf8")));
  } catch {
    return null;
  }
}

export async function removeAuthoringSession(id: string): Promise<void> {
  await rm(authoringSessionPath(id), { force: true });
}

export async function listAuthoringSessionFiles(): Promise<string[]> {
  try {
    return await readdir(sessionsRoot());
  } catch {
    return [];
  }
}
