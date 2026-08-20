/** Local HMAC authority for reviewed-origin sidecars.
 *
 * This deliberately uses a different secret and domain labels from capture
 * issuance. A reviewed human assertion cannot be confused with a native
 * frozen-origin receipt, and a map/recipe JSON document cannot create either.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ReviewedDocumentOriginLedger,
  ReviewedDocumentOriginProjection,
} from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

const AUTHORITY_SECRET = ".reviewed-document-origin-authority";
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function secretPath(): string {
  return join(stateRoot(), AUTHORITY_SECRET);
}

function canonicalProjection(
  projection: Omit<ReviewedDocumentOriginProjection, "authorization">,
): string {
  return JSON.stringify({
    domain: "relay-reviewed-document-origin/projection/v1",
    schemaVersion: projection.schemaVersion,
    id: projection.id,
    binding: projection.binding,
    approval: projection.approval,
  });
}

function canonicalLedger(ledger: Omit<ReviewedDocumentOriginLedger, "authorization">): string {
  return JSON.stringify({
    domain: "relay-reviewed-document-origin/ledger/v1",
    schemaVersion: ledger.schemaVersion,
    projectionId: ledger.projectionId,
    sequence: ledger.sequence,
    ...(ledger.previousAuthorizationSignature !== undefined
      ? { previousAuthorizationSignature: ledger.previousAuthorizationSignature }
      : {}),
    status: ledger.status,
    createdAt: ledger.createdAt,
    ...(ledger.activatedAt !== undefined ? { activatedAt: ledger.activatedAt } : {}),
    ...(ledger.revocation ? { revocation: ledger.revocation } : {}),
  });
}

function signatureFor(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

async function readExistingSecret(): Promise<Buffer | undefined> {
  try {
    const secret = Buffer.from((await readFile(secretPath(), "utf8")).trim(), "base64url");
    if (secret.length !== 32) throw new Error("Reviewed document-origin authority is invalid");
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
    if (!concurrent) throw new Error("Reviewed document-origin authority disappeared");
    return concurrent;
  }
}

export async function issueReviewedDocumentOriginProjectionAuthorization(
  projection: Omit<ReviewedDocumentOriginProjection, "authorization">,
): Promise<ReviewedDocumentOriginProjection["authorization"]> {
  return {
    schemaVersion: 1,
    issuer: "relay-local-reviewed-origin",
    signature: signatureFor(canonicalProjection(projection), await authoritySecretForIssuance()),
  };
}

export async function issueReviewedDocumentOriginLedgerAuthorization(
  ledger: Omit<ReviewedDocumentOriginLedger, "authorization">,
): Promise<ReviewedDocumentOriginLedger["authorization"]> {
  return {
    schemaVersion: 1,
    issuer: "relay-local-reviewed-origin-ledger",
    signature: signatureFor(canonicalLedger(ledger), await authoritySecretForIssuance()),
  };
}

async function signatureIsValid(payload: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) return false;
  let secret: Buffer | undefined;
  try {
    secret = await readExistingSecret();
  } catch {
    return false;
  }
  if (!secret) return false;
  const expected = Buffer.from(signatureFor(payload, secret), "base64url");
  const actual = Buffer.from(signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function reviewedDocumentOriginProjectionAuthorizationIsValid(
  projection: ReviewedDocumentOriginProjection | undefined,
): Promise<boolean> {
  if (
    !projection ||
    projection.authorization?.schemaVersion !== 1 ||
    projection.authorization.issuer !== "relay-local-reviewed-origin"
  ) {
    return false;
  }
  const { authorization: _authorization, ...unsigned } = projection;
  return signatureIsValid(canonicalProjection(unsigned), projection.authorization.signature);
}

export async function reviewedDocumentOriginLedgerAuthorizationIsValid(
  ledger: ReviewedDocumentOriginLedger | undefined,
): Promise<boolean> {
  if (
    !ledger ||
    ledger.authorization?.schemaVersion !== 1 ||
    ledger.authorization.issuer !== "relay-local-reviewed-origin-ledger"
  ) {
    return false;
  }
  const { authorization: _authorization, ...unsigned } = ledger;
  return signatureIsValid(canonicalLedger(unsigned), ledger.authorization.signature);
}
