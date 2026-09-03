/** Authority for web deployment provenance.
 *
 * A deployment URL and digest are claims, not evidence. This seam keeps the
 * provider fields together in a signed receipt and gives the control plane a
 * single fail-closed verifier. The receipt issuer is deliberately distinct
 * from the Relay actor: callers can submit a receipt, but cannot mint one via
 * the ordinary mutable build.save operation.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Build, WebBuildProviderReceipt } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";

const AUTHORITY_SECRET = ".web-build-provider-authority";
const EXACT_SHA = /^[a-f0-9]{40}$/u;
const DEPLOYMENT_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;

export type AuthoritativeWebDeployment = {
  provider: string;
  deploymentId: string;
  sourceUrl: string;
  sourceSha: string;
  deploymentDigest: `sha256:${string}`;
  configuration: string;
  environmentRevision: string;
};

/** A provider adapter must look up the exact identity requested by the
 * reviewed build. The callback is an application-owned authority seam; it is
 * never exposed through the mutable build.save transport. */
export type AuthoritativeWebDeploymentLookup = (
  expected: Omit<AuthoritativeWebDeployment, "provider">,
) => Promise<AuthoritativeWebDeployment>;

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function secretPath(): string {
  return join(stateRoot(), AUTHORITY_SECRET);
}

function canonicalReceipt(receipt: Omit<WebBuildProviderReceipt, "signature">): string {
  return JSON.stringify({
    domain: "relay-web-deployment-provider/v1",
    schemaVersion: receipt.schemaVersion,
    issuer: receipt.issuer,
    provider: receipt.provider,
    deploymentId: receipt.deploymentId,
    sourceUrl: receipt.sourceUrl,
    sourceSha: receipt.sourceSha,
    deploymentDigest: receipt.deploymentDigest,
    configuration: receipt.configuration,
    environmentRevision: receipt.environmentRevision,
    issuedAt: receipt.issuedAt,
  });
}

function signatureFor(receipt: Omit<WebBuildProviderReceipt, "signature">, secret: Buffer): string {
  return createHmac("sha256", secret).update(canonicalReceipt(receipt)).digest("base64url");
}

async function readExistingSecret(): Promise<Buffer | undefined> {
  try {
    const secret = Buffer.from((await readFile(secretPath(), "utf8")).trim(), "base64url");
    if (secret.length !== 32) throw new Error("Web deployment provider authority is invalid");
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
    if (!concurrent) throw new Error("Web deployment provider authority disappeared");
    return concurrent;
  }
}

function validReceiptShape(receipt: unknown): receipt is WebBuildProviderReceipt {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const value = receipt as Partial<WebBuildProviderReceipt>;
  if (
    value.schemaVersion !== 1 ||
    value.issuer !== "relay-web-deployment-provider" ||
    typeof value.provider !== "string" ||
    !value.provider.trim() ||
    typeof value.deploymentId !== "string" ||
    !value.deploymentId.trim() ||
    typeof value.sourceUrl !== "string" ||
    typeof value.sourceSha !== "string" ||
    !EXACT_SHA.test(value.sourceSha) ||
    typeof value.deploymentDigest !== "string" ||
    !DEPLOYMENT_DIGEST.test(value.deploymentDigest) ||
    typeof value.configuration !== "string" ||
    !value.configuration.trim() ||
    typeof value.environmentRevision !== "string" ||
    !value.environmentRevision.trim() ||
    typeof value.issuedAt !== "number" ||
    !Number.isSafeInteger(value.issuedAt) ||
    typeof value.signature !== "string" ||
    !SIGNATURE.test(value.signature)
  ) {
    return false;
  }
  try {
    const url = new URL(value.sourceUrl);
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return true;
}

/** Issue a receipt after a trusted provider adapter has returned deployment
 * facts. HTTP clients must never be given this authority directly. */
export async function issueWebBuildProviderReceipt(input: {
  provider: string;
  deploymentId: string;
  sourceUrl: string;
  sourceSha: string;
  deploymentDigest: `sha256:${string}`;
  configuration: string;
  environmentRevision: string;
  issuedAt?: number;
}): Promise<WebBuildProviderReceipt> {
  const unsigned: Omit<WebBuildProviderReceipt, "signature"> = {
    schemaVersion: 1,
    issuer: "relay-web-deployment-provider",
    provider: input.provider.trim(),
    deploymentId: input.deploymentId.trim(),
    sourceUrl: input.sourceUrl.trim(),
    sourceSha: input.sourceSha,
    deploymentDigest: input.deploymentDigest,
    configuration: input.configuration.trim(),
    environmentRevision: input.environmentRevision.trim(),
    issuedAt: input.issuedAt ?? Date.now(),
  };
  if (!validReceiptShape({ ...unsigned, signature: "x".repeat(43) })) {
    throw new Error("Cannot issue an invalid web deployment provider receipt");
  }
  return { ...unsigned, signature: signatureFor(unsigned, await authoritySecretForIssuance()) };
}

/** Resolve provider facts before Relay signs the local receipt. A reviewed
 * URL/digest/configuration is only an expectation: it cannot become a
 * provider-verified Build unless the trusted adapter returns the same facts. */
export async function issueWebBuildProviderReceiptFromAuthority(input: {
  expected: Omit<AuthoritativeWebDeployment, "provider">;
  lookup: AuthoritativeWebDeploymentLookup;
}): Promise<{ deployment: AuthoritativeWebDeployment; receipt: WebBuildProviderReceipt }> {
  const deployment = await input.lookup(input.expected);
  assertAuthoritativeWebDeploymentMatches(input.expected, deployment);
  const receipt = await issueWebBuildProviderReceipt(deployment);
  return { deployment, receipt };
}

/** Fail closed when a provider adapter returns malformed or stale facts. */
export function assertAuthoritativeWebDeploymentMatches(
  expected: Omit<AuthoritativeWebDeployment, "provider">,
  deployment: AuthoritativeWebDeployment,
): void {
  const fields: Array<keyof Omit<AuthoritativeWebDeployment, "provider">> = [
    "deploymentId",
    "sourceUrl",
    "sourceSha",
    "deploymentDigest",
    "configuration",
    "environmentRevision",
  ];
  for (const field of fields) {
    if (deployment[field] !== expected[field]) {
      throw new Error(`Authoritative web deployment lookup changed ${field}`);
    }
  }
  if (
    !validReceiptShape({
      ...deployment,
      schemaVersion: 1,
      issuer: "relay-web-deployment-provider",
      issuedAt: 0,
      signature: "x".repeat(43),
    })
  ) {
    throw new Error("Authoritative web deployment lookup returned invalid facts");
  }
}

function expectedFields(
  build: Pick<
    Build,
    "sourceUrl" | "sourceSha" | "deploymentDigest" | "configuration" | "environmentRevision"
  >,
) {
  return {
    sourceUrl: build.sourceUrl,
    sourceSha: build.sourceSha,
    deploymentDigest: build.deploymentDigest,
    configuration: build.configuration,
    environmentRevision: build.environmentRevision,
  };
}

/** Validate a receipt against Relay's local authority and optional exact build
 * fields. Missing authority state, copied signatures, and field drift fail
 * closed. This is synchronous so Proof binding remains a pure synchronous
 * admission check for existing callers. */
export function webBuildProviderReceiptIsValid(
  receipt: unknown,
  build?: Pick<
    Build,
    "sourceUrl" | "sourceSha" | "deploymentDigest" | "configuration" | "environmentRevision"
  >,
): receipt is WebBuildProviderReceipt {
  if (!validReceiptShape(receipt)) return false;
  if (build) {
    const expected = expectedFields(build);
    if (
      receipt.sourceUrl !== expected.sourceUrl ||
      receipt.sourceSha !== expected.sourceSha ||
      receipt.deploymentDigest !== expected.deploymentDigest ||
      receipt.configuration !== expected.configuration ||
      receipt.environmentRevision !== expected.environmentRevision
    ) {
      return false;
    }
  }
  let secret: Buffer;
  try {
    const bytes = readFileSync(secretPath(), "utf8").trim();
    secret = Buffer.from(bytes, "base64url");
  } catch {
    return false;
  }
  if (secret.length !== 32) return false;
  const { signature: _signature, ...unsigned } = receipt;
  const expected = Buffer.from(signatureFor(unsigned, secret), "base64url");
  const actual = Buffer.from(receipt.signature, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertWebBuildProviderReceipt(
  receipt: unknown,
  build?: Pick<
    Build,
    "sourceUrl" | "sourceSha" | "deploymentDigest" | "configuration" | "environmentRevision"
  >,
): asserts receipt is WebBuildProviderReceipt {
  if (!webBuildProviderReceiptIsValid(receipt, build)) {
    throw new Error("Web build provider verification requires an exact signed provider receipt");
  }
}
