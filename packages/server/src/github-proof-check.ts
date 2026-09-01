import { changeProofProviderCheckSchema, type ChangeProofProviderCheck } from "@relay/protocol";

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/u;

export type GitHubProofCheckConfig = {
  owner: string;
  repository: string;
  token: string;
  apiBaseUrl?: string;
};

export type PublishedProofCheck = {
  provider: "github";
  checkRunId: number;
  externalId: string;
  headSha: string;
  htmlUrl?: string;
};

export class ProofCheckPublishError extends Error {
  readonly provider = "github";
  readonly status?: number;
  readonly requestId?: string;

  constructor(message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "ProofCheckPublishError";
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

function configuredSegment(value: string, name: string): string {
  const result = value.trim();
  if (!result || !REPOSITORY_SEGMENT.test(result)) {
    throw new ProofCheckPublishError(`GitHub ${name} is not a valid repository segment`);
  }
  return result;
}

function configuredToken(value: string): string {
  const result = value.trim();
  if (!result || /\s/u.test(result) || result.length > 4_096) {
    throw new ProofCheckPublishError("GitHub Checks write token is missing or invalid");
  }
  return result;
}

function configuredBaseUrl(value: string | undefined): string {
  const result = new URL(value?.trim() || "https://api.github.com");
  const loopback =
    result.protocol === "http:" &&
    (result.hostname === "localhost" ||
      result.hostname === "127.0.0.1" ||
      result.hostname === "[::1]");
  if (result.protocol !== "https:" && !loopback) {
    throw new ProofCheckPublishError("GitHub API base URL must use https or loopback http");
  }
  result.pathname = result.pathname.replace(/\/+$/u, "");
  result.search = "";
  result.hash = "";
  return result.toString().replace(/\/$/u, "");
}

function githubConclusion(
  value: NonNullable<ChangeProofProviderCheck["conclusion"]>,
): "success" | "failure" | "action_required" {
  return value === "action-required" ? "action_required" : value;
}

function existingCheckRunId(
  value: PublishedProofCheck | undefined,
  check: ChangeProofProviderCheck,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    value.provider !== "github" ||
    typeof value.checkRunId !== "number" ||
    !Number.isSafeInteger(value.checkRunId) ||
    value.checkRunId <= 0 ||
    value.headSha !== check.headSha ||
    value.externalId !== check.externalId
  ) {
    throw new ProofCheckPublishError(
      "The existing GitHub Proof receipt does not match the exact Proof head and identity",
    );
  }
  return value.checkRunId;
}

async function reconcileUnacknowledgedCheckRun(input: {
  check: ChangeProofProviderCheck;
  baseUrl: string;
  owner: string;
  repository: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<number | undefined> {
  const url = new URL(
    `${input.baseUrl}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/commits/${input.check.headSha}/check-runs`,
  );
  url.searchParams.set("check_name", input.check.name);
  url.searchParams.set("filter", "all");
  url.searchParams.set("per_page", "100");
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  const requestId = response.headers.get("x-github-request-id") ?? undefined;
  if (!response.ok) {
    throw new ProofCheckPublishError(
      `GitHub Checks API could not reconcile the Proof (${response.status})`,
      { status: response.status, ...(requestId ? { requestId } : {}) },
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProofCheckPublishError(
      "GitHub Checks API returned an invalid reconciliation response",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProofCheckPublishError(
      "GitHub Checks API returned an invalid reconciliation response",
    );
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.total_count !== "number" ||
    !Number.isSafeInteger(record.total_count) ||
    record.total_count < 0 ||
    !Array.isArray(record.check_runs) ||
    record.check_runs.length > 100
  ) {
    throw new ProofCheckPublishError(
      "GitHub Checks API returned an invalid reconciliation response",
    );
  }
  const matches = record.check_runs.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).head_sha === input.check.headSha &&
      (candidate as Record<string, unknown>).external_id === input.check.externalId,
  ) as Array<Record<string, unknown>>;
  if (matches.length > 1) {
    throw new ProofCheckPublishError(
      "GitHub has multiple check runs for the exact Proof identity; review is required",
    );
  }
  const match = matches[0];
  if (match) {
    if (typeof match.id !== "number" || !Number.isSafeInteger(match.id) || match.id <= 0) {
      throw new ProofCheckPublishError("GitHub returned an invalid check-run identity");
    }
    return match.id;
  }
  if (record.total_count > record.check_runs.length) {
    throw new ProofCheckPublishError(
      "GitHub check reconciliation was incomplete; Relay will not risk a duplicate check",
    );
  }
  return undefined;
}

/** Explicit GitHub side-effect adapter. Core produces a provider-neutral,
 * exact-head check payload; only this configured boundary receives the token
 * and performs network I/O. */
export async function publishGitHubProofCheck(input: {
  check: unknown;
  config: GitHubProofCheckConfig;
  /** A previously acknowledged check run. Supplying it updates that run in place. */
  existing?: PublishedProofCheck;
  /** Recover a provider success whose local receipt may have been lost before retrying. */
  reconcileUnacknowledged?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<PublishedProofCheck> {
  const check = changeProofProviderCheckSchema.parse(input.check);
  if (check.title.length > 255) {
    throw new ProofCheckPublishError("GitHub check title exceeds 255 characters");
  }
  const owner = configuredSegment(input.config.owner, "owner");
  const repository = configuredSegment(input.config.repository, "repository");
  const token = configuredToken(input.config.token);
  const baseUrl = configuredBaseUrl(input.config.apiBaseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  let existingId = existingCheckRunId(input.existing, check);
  if (existingId === undefined && input.reconcileUnacknowledged) {
    existingId = await reconcileUnacknowledgedCheckRun({
      check,
      baseUrl,
      owner,
      repository,
      token,
      fetchImpl,
    });
  }
  const endpoint =
    existingId === undefined
      ? `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs`
      : `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs/${existingId}`;
  const response = await fetchImpl(endpoint, {
    method: existingId === undefined ? "POST" : "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({
      name: check.name,
      ...(existingId === undefined ? { head_sha: check.headSha } : {}),
      status: check.status,
      ...(check.status === "completed" ? { conclusion: githubConclusion(check.conclusion) } : {}),
      external_id: check.externalId,
      ...(check.detailsUrl ? { details_url: check.detailsUrl } : {}),
      output: { title: check.title, summary: check.summary, text: check.text },
    }),
  });
  const requestId = response.headers.get("x-github-request-id") ?? undefined;
  if (!response.ok) {
    throw new ProofCheckPublishError(`GitHub Checks API rejected the Proof (${response.status})`, {
      status: response.status,
      ...(requestId ? { requestId } : {}),
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProofCheckPublishError("GitHub Checks API returned an invalid response", {
      status: response.status,
      ...(requestId ? { requestId } : {}),
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProofCheckPublishError("GitHub Checks API returned an invalid response");
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.id !== "number" ||
    !Number.isSafeInteger(record.id) ||
    record.id <= 0 ||
    (existingId !== undefined && record.id !== existingId) ||
    record.head_sha !== check.headSha ||
    record.external_id !== check.externalId
  ) {
    throw new ProofCheckPublishError(
      "GitHub Checks API response did not confirm the exact Proof head and identity",
    );
  }
  return {
    provider: "github",
    checkRunId: record.id,
    externalId: check.externalId,
    headSha: check.headSha,
    ...(typeof record.html_url === "string" ? { htmlUrl: record.html_url } : {}),
  };
}
