import { createHmac, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import {
  advanceChangeVerification,
  canonicalSha256,
  type GitHubProofDeliveryClaim,
  createChangeVerification,
  claimGitHubProofDelivery,
  completeGitHubProofDelivery,
  listChangeVerifications,
  readGitHubProofDeliveryDigest,
  recordGitHubProofDeliveryDigest,
  supersedeChangeVerification,
  type ChangeVerificationScope,
} from "@relay/core";
import { changeTestedSha, type ChangeVerification, type VerificationPlan } from "@relay/protocol";
import {
  prepareCurrentChangeVerification,
  proofPreparationStartInput,
} from "./change-proof-preparation.js";
import { defaultProofExecutionCoordinator } from "./change-proof-execution-runtime.js";

const DELIVERY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SHA = /^[a-f0-9]{40}$/u;
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export type VerifiedGitHubPullRequest = {
  repository: string;
  pullRequest: number;
  headSha: string;
  baseRef: string;
  state: "open" | "closed";
};

export type GitHubPullRequestVerificationConfig = {
  owner: string;
  repository: string;
  token: string;
  apiBaseUrl?: string;
};

export type GitHubProofWebhookConfiguration = {
  secret: string;
  repository: string;
  scope: ChangeVerificationScope;
  runtime: GitHubProofIntakeRuntime;
};

export type GitHubProofIntakeRuntime = {
  verifyPullRequest(input: {
    repository: string;
    pullRequest: number;
  }): Promise<VerifiedGitHubPullRequest>;
  prepareExactHead(input: VerifiedGitHubPullRequest): Promise<VerificationPlan>;
  activeProofs(input: {
    scope: ChangeVerificationScope;
    repository: string;
    pullRequest: number;
  }): Promise<ChangeVerification[]>;
  cancel(input: {
    proof: ChangeVerification;
    requestId: string;
    requestDigest: `sha256:${string}`;
    reason: string;
  }): Promise<ChangeVerification>;
  supersede(input: {
    proof: ChangeVerification;
    plan: VerificationPlan;
    replacementId: string;
    requestId: string;
    requestDigest: `sha256:${string}`;
  }): Promise<ChangeVerification>;
  create(input: {
    plan: VerificationPlan;
    proofId: string;
    requestId: string;
    requestDigest: `sha256:${string}`;
  }): Promise<ChangeVerification>;
  deliveryDigest(deliveryId: string): Promise<string | undefined>;
  recordDelivery(deliveryId: string, digest: `sha256:${string}`): Promise<void>;
  /** Durable claim/complete hooks. Kept optional for explicitly supported
   * legacy test/runtime adapters; the production runtime always supplies both. */
  claimDelivery?(
    deliveryId: string,
    digest: `sha256:${string}`,
  ): Promise<GitHubProofDeliveryClaim | "claimed" | "pending" | "completed">;
  completeDelivery?(
    deliveryId: string,
    digest: `sha256:${string}`,
    claimToken?: string,
  ): Promise<void>;
};

export class GitHubProofIntakeError extends Error {
  constructor(
    readonly code:
      | "WEBHOOK_SIGNATURE_INVALID"
      | "WEBHOOK_HEADERS_INVALID"
      | "WEBHOOK_PAYLOAD_INVALID"
      | "WEBHOOK_REPLAY_CONFLICT"
      | "PULL_REQUEST_VERIFICATION_MISMATCH"
      | "PREPARED_HEAD_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "GitHubProofIntakeError";
  }
}

export async function readGitHubWebhookBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      throw new GitHubProofIntakeError(
        "WEBHOOK_PAYLOAD_INVALID",
        "GitHub webhook payload exceeds the 2 MiB limit",
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

function githubApiBaseUrl(value: string | undefined): string {
  const url = new URL(value?.trim() || "https://api.github.com");
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !loopback) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      "GitHub API base URL must use HTTPS or loopback HTTP",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export async function verifyGitHubPullRequest(input: {
  repository: string;
  pullRequest: number;
  config: GitHubPullRequestVerificationConfig;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedGitHubPullRequest> {
  const configuredRepository = `${input.config.owner}/${input.config.repository}`;
  if (
    input.repository !== configuredRepository ||
    !REPOSITORY.test(configuredRepository) ||
    !input.config.token.trim() ||
    /\s/u.test(input.config.token)
  ) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      "GitHub pull request verification configuration does not match the delivery",
    );
  }
  const baseUrl = githubApiBaseUrl(input.config.apiBaseUrl);
  const response = await (input.fetchImpl ?? fetch)(
    `${baseUrl}/repos/${encodeURIComponent(input.config.owner)}/${encodeURIComponent(input.config.repository)}/pulls/${input.pullRequest}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.config.token}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  );
  if (!response.ok) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      `GitHub pull request verification failed (${response.status})`,
    );
  }
  const value = (await response.json()) as Record<string, unknown>;
  const repository = value.base as Record<string, unknown> | undefined;
  const baseRepository = repository?.repo as Record<string, unknown> | undefined;
  const head = value.head as Record<string, unknown> | undefined;
  const base = value.base as Record<string, unknown> | undefined;
  if (
    value.number !== input.pullRequest ||
    baseRepository?.full_name !== configuredRepository ||
    typeof head?.sha !== "string" ||
    !SHA.test(head.sha) ||
    typeof base?.sha !== "string" ||
    !SHA.test(base.sha) ||
    (value.state !== "open" && value.state !== "closed")
  ) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      "GitHub API returned a pull request with a different repository, identity, or revision",
    );
  }
  return {
    repository: configuredRepository,
    pullRequest: input.pullRequest,
    headSha: head.sha,
    baseRef: base.sha,
    state: value.state,
  };
}

export function createGitHubProofIntakeRuntime(input: {
  scope: ChangeVerificationScope;
  verification: GitHubPullRequestVerificationConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): GitHubProofIntakeRuntime {
  const actorId = "system:github-proof-intake";
  const currentTime = input.now ?? Date.now;
  return {
    verifyPullRequest: ({ repository, pullRequest }) =>
      verifyGitHubPullRequest({
        repository,
        pullRequest,
        config: input.verification,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      }),
    prepareExactHead: async (verified) =>
      (
        await prepareCurrentChangeVerification({
          projectId: input.scope.projectId,
          request: { baseRef: verified.baseRef, pullRequest: verified.pullRequest },
        })
      ).plan,
    activeProofs: async ({ scope }) => listChangeVerifications(scope),
    cancel: async ({ proof, requestId, requestDigest, reason }) => {
      const at = currentTime();
      await defaultProofExecutionCoordinator.cancel({
        ...input.scope,
        proofId: proof.id,
        actorId,
        reason,
        at,
        transitionProof: false,
      });
      return advanceChangeVerification({
        ...input.scope,
        proofId: proof.id,
        expectedVersion: proof.version,
        state: "cancelled",
        actorId,
        requestId,
        requestDigest,
        action: "cancel",
        at,
        cancellation: { reason, cancelledBy: actorId, cancelledAt: at },
        publication: { provider: "github" },
        smallestNextVerification: {
          kind: "review",
          reason: "This Proof was cancelled after the GitHub pull request changed.",
        },
      });
    },
    supersede: async ({ proof, plan, replacementId, requestId, requestDigest }) => {
      const at = currentTime();
      const start = proofPreparationStartInput(plan);
      const result = await supersedeChangeVerification({
        ...input.scope,
        proofId: proof.id,
        expectedVersion: proof.version,
        replacement: {
          id: replacementId,
          ...start,
          change: { ...start.change, previousHeadSha: changeTestedSha(proof.change) },
          requestedBy: actorId,
          actorId,
          requestId,
          requestDigest,
          at,
        },
        actorId,
        requestId,
        requestDigest,
        at,
        publication: { provider: "github" },
      });
      return result.replacement;
    },
    create: async ({ plan, proofId, requestId, requestDigest }) =>
      createChangeVerification({
        ...input.scope,
        id: proofId,
        ...proofPreparationStartInput(plan),
        requestedBy: actorId,
        actorId,
        requestId,
        requestDigest,
        at: currentTime(),
        publication: { provider: "github" },
      }),
    deliveryDigest: (deliveryId) => readGitHubProofDeliveryDigest({ ...input.scope, deliveryId }),
    recordDelivery: async (deliveryId, digest) => {
      await recordGitHubProofDeliveryDigest({ ...input.scope, deliveryId, digest });
    },
    claimDelivery: async (deliveryId, digest) =>
      claimGitHubProofDelivery({
        ...input.scope,
        deliveryId,
        digest,
        now: currentTime(),
      }),
    completeDelivery: async (deliveryId, digest, claimToken) => {
      await completeGitHubProofDelivery({
        ...input.scope,
        deliveryId,
        digest,
        ...(claimToken ? { claimToken } : {}),
        now: currentTime(),
      });
    },
  };
}

export function githubProofWebhookConfigurationFromEnvironment(
  input: { fetchImpl?: typeof fetch; now?: () => number } = {},
): GitHubProofWebhookConfiguration | undefined {
  const secret = process.env.RELAY_GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return undefined;
  if (secret.length < 24 || secret.length > 4_096) {
    throw new Error("RELAY_GITHUB_WEBHOOK_SECRET must be between 24 and 4096 characters");
  }
  const repository = process.env.RELAY_GITHUB_REPOSITORY?.trim();
  const token = process.env.RELAY_GITHUB_TOKEN?.trim();
  const organizationId = process.env.RELAY_GITHUB_ORGANIZATION_ID?.trim();
  const projectId = process.env.RELAY_GITHUB_PROJECT_ID?.trim();
  if (!repository || !token || !organizationId || !projectId || !REPOSITORY.test(repository)) {
    throw new Error(
      "GitHub Proof intake requires RELAY_GITHUB_REPOSITORY, RELAY_GITHUB_TOKEN, RELAY_GITHUB_ORGANIZATION_ID, and RELAY_GITHUB_PROJECT_ID when RELAY_GITHUB_WEBHOOK_SECRET is set",
    );
  }
  const [owner, repositoryName] = repository.split("/");
  const scope = { organizationId, projectId };
  return {
    secret,
    repository,
    scope,
    runtime: createGitHubProofIntakeRuntime({
      scope,
      verification: { owner: owner!, repository: repositoryName!, token },
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      ...(input.now ? { now: input.now } : {}),
    }),
  };
}

function exactHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GitHubProofIntakeError("WEBHOOK_HEADERS_INVALID", `${name} is required`);
  }
  return value.trim();
}

export function verifyGitHubWebhookSignature(input: {
  body: Buffer;
  signature: string | undefined;
  secret: string;
}): void {
  if (
    input.secret.length < 24 ||
    input.secret.length > 4_096 ||
    input.body.byteLength > MAX_WEBHOOK_BYTES
  ) {
    throw new GitHubProofIntakeError(
      "WEBHOOK_SIGNATURE_INVALID",
      "GitHub webhook authentication is unavailable or the payload is too large",
    );
  }
  const supplied = Buffer.from(input.signature ?? "", "utf8");
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", input.secret).update(input.body).digest("hex")}`,
    "utf8",
  );
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new GitHubProofIntakeError(
      "WEBHOOK_SIGNATURE_INVALID",
      "GitHub webhook signature is invalid",
    );
  }
}

function payloadRecord(body: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new GitHubProofIntakeError(
      "WEBHOOK_PAYLOAD_INVALID",
      "GitHub webhook payload must be one JSON object",
    );
  }
}

function pullRequestPayload(body: Buffer): {
  action: "opened" | "synchronize" | "closed";
  repository: string;
  pullRequest: number;
  payloadHeadSha: string;
} {
  const value = payloadRecord(body);
  const action = value.action;
  const repository = value.repository as Record<string, unknown> | undefined;
  const pullRequest = value.pull_request as Record<string, unknown> | undefined;
  const head = pullRequest?.head as Record<string, unknown> | undefined;
  const fullName = repository?.full_name;
  const number = pullRequest?.number;
  const sha = head?.sha;
  if (
    !["opened", "synchronize", "closed"].includes(String(action)) ||
    typeof fullName !== "string" ||
    !REPOSITORY.test(fullName) ||
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof sha !== "string" ||
    !SHA.test(sha)
  ) {
    throw new GitHubProofIntakeError(
      "WEBHOOK_PAYLOAD_INVALID",
      "GitHub pull_request payload has an unsupported action or invalid repository, PR, or head",
    );
  }
  return {
    action: action as "opened" | "synchronize" | "closed",
    repository: fullName,
    pullRequest: number,
    payloadHeadSha: sha,
  };
}

function relevantProofs(
  proofs: readonly ChangeVerification[],
  verified: VerifiedGitHubPullRequest,
): ChangeVerification[] {
  return proofs.filter(
    (proof) =>
      proof.change.repository === verified.repository &&
      proof.change.pullRequest === verified.pullRequest,
  );
}

export async function processGitHubPullRequestWebhook(input: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
  configuredRepository: string;
  scope: ChangeVerificationScope;
  runtime: GitHubProofIntakeRuntime;
}): Promise<{
  disposition: "created" | "updated" | "closed" | "replayed" | "pending";
  proof?: ChangeVerification;
  cancelledProofIds: string[];
}> {
  const signature = exactHeader(input.headers["x-hub-signature-256"], "X-Hub-Signature-256");
  const deliveryId = exactHeader(input.headers["x-github-delivery"], "X-GitHub-Delivery");
  const event = exactHeader(input.headers["x-github-event"], "X-GitHub-Event");
  if (!DELIVERY_ID.test(deliveryId) || event !== "pull_request") {
    throw new GitHubProofIntakeError(
      "WEBHOOK_HEADERS_INVALID",
      "Only identified GitHub pull_request deliveries are accepted",
    );
  }
  verifyGitHubWebhookSignature({ body: input.body, signature, secret: input.secret });
  const payload = pullRequestPayload(input.body);
  if (payload.repository !== input.configuredRepository) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      "Webhook repository does not match the configured Relay repository",
    );
  }
  const digest = canonicalSha256({ event, deliveryId, payload: payloadRecord(input.body) });
  const durableDelivery =
    input.runtime.claimDelivery !== undefined && input.runtime.completeDelivery !== undefined;
  let claimToken: string | undefined;
  if (durableDelivery) {
    let claim: GitHubProofDeliveryClaim | "claimed" | "pending" | "completed";
    try {
      claim = await input.runtime.claimDelivery!(deliveryId, digest);
    } catch (error) {
      if (
        error instanceof Error &&
        /already bound|delivery state is invalid/u.test(error.message)
      ) {
        throw new GitHubProofIntakeError(
          "WEBHOOK_REPLAY_CONFLICT",
          "GitHub delivery id is already bound to another payload",
        );
      }
      throw error;
    }
    const claimDisposition = typeof claim === "string" ? claim : claim.disposition;
    claimToken = typeof claim === "string" ? undefined : claim.state.claimToken;
    if (claimDisposition === "completed") return { disposition: "replayed", cancelledProofIds: [] };
    if (claimDisposition === "pending") return { disposition: "pending", cancelledProofIds: [] };
  } else {
    const previousDigest = await input.runtime.deliveryDigest(deliveryId);
    if (previousDigest !== undefined) {
      if (previousDigest !== digest) {
        throw new GitHubProofIntakeError(
          "WEBHOOK_REPLAY_CONFLICT",
          "GitHub delivery id is already bound to another payload",
        );
      }
      return { disposition: "replayed", cancelledProofIds: [] };
    }
  }

  const completeDelivery = durableDelivery
    ? () => input.runtime.completeDelivery!(deliveryId, digest, claimToken)
    : () => input.runtime.recordDelivery(deliveryId, digest);

  const verified = await input.runtime.verifyPullRequest({
    repository: payload.repository,
    pullRequest: payload.pullRequest,
  });
  if (
    verified.repository !== payload.repository ||
    verified.pullRequest !== payload.pullRequest ||
    verified.headSha !== payload.payloadHeadSha ||
    verified.state !== (payload.action === "closed" ? "closed" : "open")
  ) {
    throw new GitHubProofIntakeError(
      "PULL_REQUEST_VERIFICATION_MISMATCH",
      "GitHub API verification does not match the signed pull_request delivery",
    );
  }

  const requestId = `github:${deliveryId}`;
  const proofs = relevantProofs(
    await input.runtime.activeProofs({
      scope: input.scope,
      repository: verified.repository,
      pullRequest: verified.pullRequest,
    }),
    verified,
  );
  const cancelledProofIds: string[] = [];
  if (payload.action === "closed") {
    for (const proof of proofs.filter(
      (candidate) => !["cancelled", "superseded"].includes(candidate.state),
    )) {
      if (["proved", "rejected", "needs-review", "insufficient-evidence"].includes(proof.state))
        continue;
      await input.runtime.cancel({
        proof,
        requestId,
        requestDigest: digest,
        reason: "GitHub pull request closed before this Proof completed.",
      });
      cancelledProofIds.push(proof.id);
    }
    await completeDelivery();
    return { disposition: "closed", cancelledProofIds };
  }

  const plan = await input.runtime.prepareExactHead(verified);
  if (
    plan.change.repository !== verified.repository ||
    plan.change.pullRequest !== verified.pullRequest ||
    changeTestedSha(plan.change) !== verified.headSha
  ) {
    throw new GitHubProofIntakeError(
      "PREPARED_HEAD_MISMATCH",
      "Locally prepared Proof does not match the GitHub-verified pull request head",
    );
  }
  const exact = proofs.find((proof) => changeTestedSha(proof.change) === verified.headSha);
  if (exact) {
    await completeDelivery();
    return { disposition: "updated", proof: exact, cancelledProofIds };
  }
  for (const proof of proofs.filter(
    (candidate) =>
      ![
        "proved",
        "rejected",
        "needs-review",
        "insufficient-evidence",
        "cancelled",
        "superseded",
      ].includes(candidate.state),
  )) {
    await input.runtime.cancel({
      proof,
      requestId,
      requestDigest: digest,
      reason: `GitHub pull request advanced to ${verified.headSha}.`,
    });
    cancelledProofIds.push(proof.id);
  }
  const priorTerminal = proofs
    .filter((candidate) =>
      ["proved", "rejected", "needs-review", "insufficient-evidence"].includes(candidate.state),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const proofId = `github-proof-${canonicalSha256({ ...input.scope, ...verified }).slice(7, 39)}`;
  const proof = priorTerminal
    ? await input.runtime.supersede({
        proof: priorTerminal,
        plan,
        replacementId: proofId,
        requestId,
        requestDigest: digest,
      })
    : await input.runtime.create({ plan, proofId, requestId, requestDigest: digest });
  await completeDelivery();
  return {
    disposition: priorTerminal ? "updated" : "created",
    proof,
    cancelledProofIds,
  };
}
