import { operationInputContract } from "./operation-builders.js";

export type RunOutcome =
  | "passed"
  | "product-failure"
  | "harness-failure"
  | "uncertain"
  | "cancelled";

/** A capability link is intentionally narrower than a persisted run. It never
 * exposes selectors, logs, resolved inputs, raw evidence, or device identity. */
export type RunShareSummary = {
  schemaVersion: 1;
  id: string;
  runId: string;
  batchId?: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  createdBy: string;
  runCount: number;
  frameCount: number;
  status: "active" | "expired" | "revoked";
  revokedAt?: number;
};

export type RunShareCreateResult = {
  share: RunShareSummary;
  /** Opaque bearer capability. Returned once when the share is created. */
  token: string;
  /** Relative so a reverse proxy or desktop host can choose its public origin. */
  path: string;
};

export type RunShareFrame = {
  index: number;
  caption: string;
  capturedAt: number;
  width?: number;
  height?: number;
};

export type RunShareReportRun = {
  id: string;
  title: string;
  status: string;
  outcome?: RunOutcome;
  platform?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  caseIndex?: number;
  caseCount?: number;
  frames: RunShareFrame[];
};

export type RunShareReport = {
  schemaVersion: 1;
  share: Pick<RunShareSummary, "id" | "title" | "createdAt" | "expiresAt">;
  totals: {
    runs: number;
    passed: number;
    problems: number;
    screenshots: number;
  };
  runs: RunShareReportRun[];
};

type Parser<T> = { readonly description: string; parse(value: unknown): T };

export type RunShareOperationMap = {
  "run.share.list": { input: { runId: string }; output: { shares: RunShareSummary[] } };
  "run.share.create": {
    input: { runId: string; expiresInHours: number; includeBatch?: boolean };
    output: RunShareCreateResult;
  };
  "run.share.revoke": {
    input: { runId: string; shareId: string };
    output: { share: RunShareSummary };
  };
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function shareSummary(value: unknown, label: string): RunShareSummary {
  const share = object(value, label);
  if (share.schemaVersion !== 1) throw new Error(`${label} schemaVersion must be 1`);
  requiredString(share.id, `${label} id`);
  requiredString(share.runId, `${label} runId`);
  requiredString(share.title, `${label} title`);
  finiteNumber(share.createdAt, `${label} createdAt`);
  finiteNumber(share.expiresAt, `${label} expiresAt`);
  requiredString(share.createdBy, `${label} createdBy`);
  finiteNumber(share.runCount, `${label} runCount`);
  finiteNumber(share.frameCount, `${label} frameCount`);
  if (share.status !== "active" && share.status !== "expired" && share.status !== "revoked") {
    throw new Error(`${label} status must be active, expired, or revoked`);
  }
  return share as RunShareSummary;
}

export const runShareListInputParser: Parser<{ runId: string }> = {
  description: "run share list input",
  parse(value) {
    const input = object(value, this.description);
    return { runId: requiredString(input.runId, "run share runId") };
  },
};

export const runShareCreateInputParser: Parser<{
  runId: string;
  expiresInHours: number;
  includeBatch?: boolean;
}> = {
  description: "run share create input",
  parse(value) {
    const input = object(value, this.description);
    const expiresInHours = finiteNumber(input.expiresInHours, "run share expiresInHours");
    if (expiresInHours < 5 / 60 || expiresInHours > 30 * 24) {
      throw new Error("run share expiresInHours must be between 5 minutes and 30 days");
    }
    if (input.includeBatch !== undefined && typeof input.includeBatch !== "boolean") {
      throw new Error("run share includeBatch must be a boolean");
    }
    return {
      runId: requiredString(input.runId, "run share runId"),
      expiresInHours,
      ...(input.includeBatch !== undefined ? { includeBatch: input.includeBatch as boolean } : {}),
    };
  },
};

export const runShareRevokeInputParser: Parser<{ runId: string; shareId: string }> = {
  description: "run share revoke input",
  parse(value) {
    const input = object(value, this.description);
    return {
      runId: requiredString(input.runId, "run share runId"),
      shareId: requiredString(input.shareId, "run share shareId"),
    };
  },
};

export const runShareListOutputParser: Parser<{ shares: RunShareSummary[] }> = {
  description: "run share list response",
  parse(value) {
    const input = object(value, this.description);
    if (!Array.isArray(input.shares)) throw new Error("run shares must be an array");
    return {
      shares: input.shares.map((share, index) => shareSummary(share, `run share ${index + 1}`)),
    };
  },
};

export const runShareCreateOutputParser: Parser<RunShareCreateResult> = {
  description: "run share create response",
  parse(value) {
    const input = object(value, this.description);
    return {
      share: shareSummary(input.share, "run share"),
      token: requiredString(input.token, "run share token"),
      path: requiredString(input.path, "run share path"),
    };
  },
};

export const runShareRevokeOutputParser: Parser<{ share: RunShareSummary }> = {
  description: "run share revoke response",
  parse(value) {
    return { share: shareSummary(object(value, this.description).share, "run share") };
  },
};

export const runShareOperationDefinitions = [
  {
    id: "run.share.list",
    version: 1,
    label: "List signed Run shares",
    category: "evidence",
    mode: "query",
    input: operationInputContract("run.share.list", runShareListInputParser),
    output: runShareListOutputParser,
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    minimumRole: "admin",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path: "/runs/:runId/shares" },
  },
  {
    id: "run.share.create",
    label: "Create signed Run share",
    path: "/runs/:runId/shares",
    input: operationInputContract("run.share.create", runShareCreateInputParser),
    output: runShareCreateOutputParser,
    version: 1 as const,
    category: "evidence" as const,
    mode: "command" as const,
    idempotency: "optional" as const,
    targetCapabilities: [],
    lease: "none" as const,
    confirmation: "confirm" as const,
    minimumRole: "admin" as const,
    progress: false,
    cancellable: false,
    transport: { method: "POST" as const, path: "/runs/:runId/shares" },
  },
  {
    id: "run.share.revoke",
    label: "Revoke signed Run share",
    path: "/runs/:runId/shares/:shareId/revoke",
    input: operationInputContract("run.share.revoke", runShareRevokeInputParser),
    output: runShareRevokeOutputParser,
    version: 1 as const,
    category: "evidence" as const,
    mode: "command" as const,
    idempotency: "optional" as const,
    targetCapabilities: [],
    lease: "none" as const,
    confirmation: "confirm" as const,
    minimumRole: "admin" as const,
    progress: false,
    cancellable: false,
    transport: {
      method: "POST" as const,
      path: "/runs/:runId/shares/:shareId/revoke",
    },
  },
] as const;
