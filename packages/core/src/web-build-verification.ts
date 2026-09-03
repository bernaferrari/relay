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
import { canonicalSha256 } from "./canonical-json.js";
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

/** Facts a host asks a deployment provider to resolve. Digest and environment
 * revision are optional expectations because a provider must be allowed to
 * derive them from its immutable record. A caller-provided value is never
 * copied into the observed deployment. */
export type AuthoritativeWebDeploymentExpectation = Omit<
  AuthoritativeWebDeployment,
  "provider" | "deploymentId" | "deploymentDigest" | "environmentRevision"
> & {
  deploymentId?: string;
  deploymentDigest?: `sha256:${string}`;
  environmentRevision?: string;
};

/** A provider adapter must look up the exact identity requested by the
 * reviewed build. The callback is an application-owned authority seam; it is
 * never exposed through the mutable build.save transport. */
export type AuthoritativeWebDeploymentLookup = (
  expected: AuthoritativeWebDeploymentExpectation,
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
  expected: AuthoritativeWebDeploymentExpectation;
  lookup: AuthoritativeWebDeploymentLookup;
}): Promise<{ deployment: AuthoritativeWebDeployment; receipt: WebBuildProviderReceipt }> {
  const deployment = await input.lookup(input.expected);
  assertAuthoritativeWebDeploymentMatches(input.expected, deployment);
  const receipt = await issueWebBuildProviderReceipt(deployment);
  return { deployment, receipt };
}

/** Fail closed when a provider adapter returns malformed or stale facts. */
export function assertAuthoritativeWebDeploymentMatches(
  expected: AuthoritativeWebDeploymentExpectation,
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
    if (expected[field] !== undefined && deployment[field] !== expected[field]) {
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

const VERCEL_EXACT_SHA = /^[a-f0-9]{40}$/u;

type VercelDeploymentRecord = {
  id?: unknown;
  uid?: unknown;
  url?: unknown;
  projectId?: unknown;
  readyState?: unknown;
  state?: unknown;
  target?: unknown;
  createdAt?: unknown;
  meta?: unknown;
  gitSource?: unknown;
  source?: unknown;
  link?: unknown;
};

export type VercelWebDeploymentProviderOptions = {
  /** Vercel project id, not a mutable project name. */
  projectId: string;
  /** Canonical repository identity, for example `acme/relay`. */
  repository: string;
  /** Vercel access token. It is held in the closure and never logged or
   * included in an error or receipt. */
  token: string;
  teamId?: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeRepository(value: string): string {
  let result = value.trim().replace(/\.git$/iu, "");
  try {
    const parsed = new URL(result);
    result = parsed.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  } catch {
    // The configuration may already be owner/repository rather than a URL.
  }
  return result.toLowerCase();
}

function repositoryFromVercel(record: VercelDeploymentRecord): string | undefined {
  const meta = objectValue(record.meta);
  const gitSource = objectValue(record.gitSource);
  const source = objectValue(record.source);
  const link = objectValue(record.link);
  const githubCommitOrg = nonEmptyString(meta?.githubCommitOrg);
  const githubCommitRepo = nonEmptyString(meta?.githubCommitRepo);
  const candidates = [
    meta?.githubRepo,
    meta?.githubRepository,
    githubCommitOrg && githubCommitRepo ? `${githubCommitOrg}/${githubCommitRepo}` : undefined,
    gitSource?.repo,
    source?.repo,
    link?.repo,
  ];
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate);
    if (value) return normalizeRepository(value);
  }
  return undefined;
}

function sourceShaFromVercel(record: VercelDeploymentRecord): string | undefined {
  const meta = objectValue(record.meta);
  const gitSource = objectValue(record.gitSource);
  const source = objectValue(record.source);
  const candidates = [meta?.githubCommitSha, meta?.gitCommitSha, gitSource?.sha, source?.sha];
  for (const candidate of candidates) {
    const value = nonEmptyString(candidate)?.toLowerCase();
    if (value && VERCEL_EXACT_SHA.test(value)) return value;
  }
  return undefined;
}

function deploymentUrlFromVercel(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return undefined;
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

/** Create a production Vercel deployment lookup.
 *
 * The Vercel REST API is queried by the exact deployment URL. Relay accepts
 * only a READY deployment whose provider-issued project, Git repository, and
 * commit match the configured project and requested SHA. The signed digest is
 * derived from immutable Vercel identity fields; no URL, digest, or revision
 * is copied from the caller. An alias is rejected because its canonical
 * deployment URL differs from the URL returned by Vercel.
 */
export function createVercelWebDeploymentProvider(
  options: VercelWebDeploymentProviderOptions,
): AuthoritativeWebDeploymentLookup {
  const token = options.token.trim();
  const projectId = options.projectId.trim();
  const repository = normalizeRepository(options.repository);
  if (!token || !projectId || !repository) {
    throw new Error("Vercel web deployment provider requires token, projectId, and repository");
  }
  const apiBase = options.apiBaseUrl?.trim() || "https://api.vercel.com";
  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    throw new Error("Vercel web deployment provider API base URL is invalid");
  }
  if (base.protocol !== "https:") {
    throw new Error("Vercel web deployment provider API base URL must use https");
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
  return async (expected) => {
    let expectedUrl: URL;
    try {
      expectedUrl = new URL(expected.sourceUrl);
    } catch {
      throw new Error("Vercel web deployment lookup requires a valid deployment URL");
    }
    if (expectedUrl.protocol !== "https:") {
      throw new Error("Vercel web deployment lookup requires an https deployment URL");
    }
    // Vercel's `idOrUrl` accepts the deployment hostname (or provider UID),
    // not an arbitrary URL path. Resolve by hostname, then compare the full
    // provider-issued URL below so a branch/custom-domain alias cannot pass.
    const endpoint = new URL(`/v13/deployments/${encodeURIComponent(expectedUrl.hostname)}`, base);
    if (options.teamId?.trim()) endpoint.searchParams.set("teamId", options.teamId.trim());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch {
      throw new Error("Vercel web deployment lookup is unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`Vercel web deployment lookup failed with HTTP ${response.status}`);
    }
    let record: VercelDeploymentRecord;
    try {
      const body: unknown = await response.json();
      if (!objectValue(body)) throw new Error("not an object");
      record = body as VercelDeploymentRecord;
    } catch {
      throw new Error("Vercel web deployment lookup returned invalid JSON");
    }
    const id = nonEmptyString(record.id) ?? nonEmptyString(record.uid);
    const url = deploymentUrlFromVercel(record.url);
    const state = nonEmptyString(record.readyState) ?? nonEmptyString(record.state);
    const actualProjectId = nonEmptyString(record.projectId);
    const actualRepository = repositoryFromVercel(record);
    const sourceSha = sourceShaFromVercel(record);
    if (!id || !url || state !== "READY") {
      throw new Error("Vercel deployment is not a ready immutable deployment");
    }
    if (expected.deploymentId !== undefined && id !== expected.deploymentId) {
      throw new Error("Vercel deployment id does not match the requested deployment");
    }
    if (actualProjectId !== projectId) {
      throw new Error("Vercel deployment project does not match the configured project");
    }
    if (actualRepository !== repository) {
      throw new Error("Vercel deployment repository does not match the configured repository");
    }
    if (sourceSha !== expected.sourceSha) {
      throw new Error("Vercel deployment commit does not match the exact Proof head SHA");
    }
    if (url !== expectedUrl.toString().replace(/\/$/u, "")) {
      throw new Error("Vercel deployment URL is not the provider-issued immutable URL");
    }
    const environmentRevision = `vercel:${id}`;
    const deploymentDigest = canonicalSha256({
      provider: "vercel",
      deploymentId: id,
      sourceUrl: url,
      projectId,
      repository,
      sourceSha,
      environmentRevision,
      ...(record.target !== undefined ? { target: record.target } : {}),
      ...(typeof record.createdAt === "number" ? { createdAt: record.createdAt } : {}),
    });
    return {
      provider: "vercel",
      deploymentId: id,
      sourceUrl: url,
      sourceSha,
      deploymentDigest,
      configuration: expected.configuration,
      environmentRevision,
    };
  };
}

/** Resolve the default provider from environment without making startup
 * dependent on a particular hosting service. Partial configuration is an
 * operator error and is surfaced as an actionable setup failure. */
export function vercelWebDeploymentProviderFromEnvironment():
  | AuthoritativeWebDeploymentLookup
  | undefined {
  const token = process.env.RELAY_VERCEL_TOKEN?.trim();
  const projectId = process.env.RELAY_VERCEL_PROJECT_ID?.trim();
  const repository = process.env.RELAY_VERCEL_REPOSITORY?.trim();
  if (!token && !projectId && !repository) return undefined;
  if (!token || !projectId || !repository) {
    throw new Error(
      "Vercel web deployment provider needs RELAY_VERCEL_TOKEN, RELAY_VERCEL_PROJECT_ID, and RELAY_VERCEL_REPOSITORY",
    );
  }
  return createVercelWebDeploymentProvider({
    token,
    projectId,
    repository,
    ...(process.env.RELAY_VERCEL_TEAM_ID?.trim()
      ? { teamId: process.env.RELAY_VERCEL_TEAM_ID.trim() }
      : {}),
  });
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
