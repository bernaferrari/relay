/**
 * Local issuance authority for the one high-distance document-origin restore.
 *
 * A content-addressed JSON receipt is useful evidence, but content addressing
 * alone does not say which Relay path produced it: generic evidence persistence
 * can write the same shape. This module is deliberately not exported from the
 * public core barrel. It signs a receipt only after the survey's private
 * runtime issuance facts were checked by logical-scroll-surface persistence.
 * Verification is local by design: the underlying raw evidence is local CAS
 * too, and an imported map without this authority safely falls back to exact
 * inverse restoration.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findWorkspaceRoot } from "./workspace-root.js";

const AUTHORITY_SECRET = ".document-origin-attestation-authority";
const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

export type DocumentOriginAttestationFirstViewport = {
  index: 0;
  offsetY: 0;
  appendedHeight: 0;
  capturedAt: number;
  width: number;
  height: number;
  screenshotSha256: string;
  accessibilityTreeSha256: string;
};

export type DocumentOriginAttestationTerminalViewport = {
  capturedAt: number;
  width: number;
  height: number;
  screenshotSha256: string;
  accessibilityTreeSha256: string;
};

export type DocumentOriginAttestationBinding = {
  attestationSha256: string;
  targetProfileId: string;
  surfaceId: string;
  firstViewport: DocumentOriginAttestationFirstViewport;
  terminalViewport: DocumentOriginAttestationTerminalViewport;
};

export type DocumentOriginAttestationAuthorization = {
  schemaVersion: 1;
  issuer: "relay-local-capture";
  signature: string;
};

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function secretPath(): string {
  return join(stateRoot(), AUTHORITY_SECRET);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validViewport(viewport: unknown): viewport is DocumentOriginAttestationTerminalViewport {
  if (!record(viewport)) return false;
  return (
    Number.isSafeInteger(viewport.capturedAt) &&
    Number.isSafeInteger(viewport.width) &&
    Number.isSafeInteger(viewport.height) &&
    typeof viewport.width === "number" &&
    typeof viewport.height === "number" &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    typeof viewport.screenshotSha256 === "string" &&
    SHA256.test(viewport.screenshotSha256) &&
    typeof viewport.accessibilityTreeSha256 === "string" &&
    SHA256.test(viewport.accessibilityTreeSha256)
  );
}

function validBinding(binding: unknown): binding is DocumentOriginAttestationBinding {
  if (!record(binding)) return false;
  const firstViewport = binding.firstViewport;
  const terminalViewport = binding.terminalViewport;
  return (
    typeof binding.attestationSha256 === "string" &&
    SHA256.test(binding.attestationSha256) &&
    typeof binding.targetProfileId === "string" &&
    binding.targetProfileId.trim().length > 0 &&
    typeof binding.surfaceId === "string" &&
    binding.surfaceId.trim().length > 0 &&
    record(firstViewport) &&
    firstViewport.index === 0 &&
    firstViewport.offsetY === 0 &&
    firstViewport.appendedHeight === 0 &&
    validViewport(firstViewport) &&
    validViewport(terminalViewport)
  );
}

function canonicalBinding(binding: DocumentOriginAttestationBinding): string {
  return JSON.stringify({
    schemaVersion: 1,
    issuer: "relay-local-capture",
    attestationSha256: binding.attestationSha256,
    targetProfileId: binding.targetProfileId,
    surfaceId: binding.surfaceId,
    firstViewport: binding.firstViewport,
    terminalViewport: binding.terminalViewport,
  });
}

function signatureFor(binding: DocumentOriginAttestationBinding, secret: Buffer): string {
  return createHmac("sha256", secret).update(canonicalBinding(binding)).digest("base64url");
}

async function readExistingSecret(): Promise<Buffer | undefined> {
  try {
    const secret = Buffer.from((await readFile(secretPath(), "utf8")).trim(), "base64url");
    if (secret.length !== 32) throw new Error("Document-origin attestation authority is invalid");
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function authoritySecretForIssuance(): Promise<Buffer> {
  const existing = await readExistingSecret();
  if (existing) return existing;
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 });
  const generated = randomBytes(32);
  try {
    await writeFile(secretPath(), `${generated.toString("base64url")}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const concurrent = await readExistingSecret();
    if (!concurrent) throw new Error("Document-origin attestation authority disappeared");
    return concurrent;
  }
}

/** Internal issuance path; only logical-scroll-surface calls this after the
 * survey's immutable runtime facts match the raw evidence it is persisting. */
export async function issueDocumentOriginAttestationAuthorization(
  binding: DocumentOriginAttestationBinding,
): Promise<DocumentOriginAttestationAuthorization> {
  if (!validBinding(binding))
    throw new Error("Cannot issue an invalid document-origin attestation");
  return {
    schemaVersion: 1,
    issuer: "relay-local-capture",
    signature: signatureFor(binding, await authoritySecretForIssuance()),
  };
}

/** Internal execution guard. Missing authority state, malformed bindings, and
 * copied/self-authored receipts all fail closed without changing the device. */
export async function documentOriginAttestationAuthorizationIsValid(
  binding: unknown,
  authorization: DocumentOriginAttestationAuthorization | undefined,
): Promise<boolean> {
  if (
    !validBinding(binding) ||
    !authorization ||
    authorization.schemaVersion !== 1 ||
    authorization.issuer !== "relay-local-capture" ||
    typeof authorization.signature !== "string" ||
    !SIGNATURE.test(authorization.signature)
  ) {
    return false;
  }
  let secret: Buffer | undefined;
  try {
    secret = await readExistingSecret();
  } catch {
    return false;
  }
  if (!secret) return false;
  const expected = Buffer.from(signatureFor(binding, secret), "base64url");
  const actual = Buffer.from(authorization.signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
