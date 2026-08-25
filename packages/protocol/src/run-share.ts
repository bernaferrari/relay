import { operationInputContract } from "./operation-builders.js";
import { parseOptionalSourceRevision, type SourceRevision } from "./source-revision.js";

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
  /** Absolute public link. Present only while the host configures
   * RELAY_PUBLIC_BASE_URL; otherwise recipients resolve `path` themselves. */
  url?: string;
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
  /** Redacted, bounded reason a failed run stopped; absent for healthy runs. */
  errorHeadline?: string;
  /** Where a failed run stopped, projected from its persisted step trace. */
  failedStep?: { index: number; total: number; label: string };
  /** Bounded failure taxonomy already persisted on the run. */
  failureCategory?: string;
  frames: RunShareFrame[];
};

/** Audit-grade identity block for one share report: what was executed,
 * against what build and plan revision, and when. Every field is a
 * projection of data already persisted on the runs. */
export type RunShareReportProvenance = {
  appVersion?: string;
  platform?: string;
  profileId?: string;
  deviceName?: string;
  appMapRevision?: number;
  testRevision?: number;
  sourceRevision?: { sha: string; prNumber?: number };
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
};

export type RunShareReport = {
  schemaVersion: 1;
  share: Pick<RunShareSummary, "id" | "title" | "createdAt" | "expiresAt">;
  /** What this proves: build, plan revision, and execution window projected
   * from the persisted runs behind the share. */
  provenance?: RunShareReportProvenance;
  totals: {
    runs: number;
    passed: number;
    problems: number;
    screenshots: number;
    /** Queued/running/paused runs are not verdicts; they never count as
     * problems. */
    inProgress: number;
  };
  runs: RunShareReportRun[];
};

/** Machine verdict for one proof: `pass` means the flow ran and held,
 * `fail` means it ran and found a product problem, and `unproven` means
 * Relay could not execute (no device, no build) — deliberately distinct so
 * a missing capability never reads as a regression. */
export type ProofVerdict = "pass" | "fail" | "unproven";

export type ProofReportFlow = {
  testId: string;
  title: string;
  status: string;
  durationMs?: number;
  /** Bounded digest of the failure headline; absent for healthy flows. */
  failureDigest?: string;
  /** Where a failed flow stopped, projected from its persisted step trace. */
  failureStep?: { index: number; total: number; label: string };
  /** Relative share-report path for this run, when a share link exists. */
  sharePath?: string;
};

/** Versioned proof projection of a completed run: the PR-check payload.
 * Every field projects data already persisted on the run — nothing here is
 * authoritative execution state. */
export type ProofReport = {
  schemaVersion: 1;
  verdict: ProofVerdict;
  /** Immutable commit/build identity frozen at enqueue time, when known. */
  sourceRevision?: SourceRevision;
  flows: ProofReportFlow[];
  relayServerUrl?: string;
  generatedAt: number;
};

/** A minimal step trace shape both the app workspace and the share report
 * project from. Core `TraceStep` and the app `TraceStepDto` both satisfy it. */
export type RunShareStepTraceInput = {
  steps?: Array<{ title: string; tone: string; status?: string }>;
};

/**
 * Project where a run stopped from its persisted step trace. Shared by the
 * app runs-workspace and share reports so both surfaces name the exact same
 * step and can never drift. Returns undefined when the trace shows no failed
 * step — callers then fall back to their own stop presentation.
 */
export function failedStepFromTrace(
  trace: RunShareStepTraceInput,
): { index: number; total: number; label: string } | undefined {
  const steps = trace.steps ?? [];
  if (steps.length === 0) return undefined;
  const failed = steps.findIndex(
    (step) => step.status === "error" || step.status === "failed" || step.tone === "fail" || step.tone === "danger",
  );
  if (failed < 0) return undefined;
  return { index: failed, total: steps.length, label: steps[failed]?.title || "Unnamed step" };
}

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
    if (input.url !== undefined && typeof input.url !== "string") {
      throw new Error("run share url must be a string");
    }
    return {
      share: shareSummary(input.share, "run share"),
      token: requiredString(input.token, "run share token"),
      path: requiredString(input.path, "run share path"),
      ...(input.url !== undefined ? { url: input.url as string } : {}),
    };
  },
};

export const runShareRevokeOutputParser: Parser<{ share: RunShareSummary }> = {
  description: "run share revoke response",
  parse(value) {
    return { share: shareSummary(object(value, this.description).share, "run share") };
  },
};

export const proofReportOutputParser: Parser<ProofReport> = {
  description: "proof report response",
  parse(value) {
    const input = object(value, this.description);
    if (input.schemaVersion !== 1) throw new Error("proof report schemaVersion must be 1");
    if (input.verdict !== "pass" && input.verdict !== "fail" && input.verdict !== "unproven") {
      throw new Error("proof report verdict must be pass, fail, or unproven");
    }
    if (!Array.isArray(input.flows)) throw new Error("proof report flows must be an array");
    if (typeof input.generatedAt !== "number" || !Number.isFinite(input.generatedAt)) {
      throw new Error("proof report generatedAt must be a number");
    }
    return {
      schemaVersion: 1,
      verdict: input.verdict,
      ...(input.sourceRevision !== undefined
        ? { sourceRevision: parseOptionalSourceRevision(input.sourceRevision)! }
        : {}),
      flows: input.flows.map((flow, index): ProofReportFlow => {
        const item = object(flow, `proof report flow ${index + 1}`);
        if (typeof item.testId !== "string" || !item.testId) {
          throw new Error("proof report flow testId must be a non-empty string");
        }
        if (typeof item.title !== "string" || !item.title) {
          throw new Error("proof report flow title must be a non-empty string");
        }
        if (typeof item.status !== "string") {
          throw new Error("proof report flow status must be a string");
        }
        let durationMs: number | undefined;
        if (item.durationMs !== undefined) {
          durationMs = finiteNumber(item.durationMs, "proof report flow durationMs");
        }
        let failureDigest: string | undefined;
        if (item.failureDigest !== undefined) {
          failureDigest = requiredString(item.failureDigest, "proof report flow failureDigest");
        }
        let failureStep: ProofReportFlow["failureStep"];
        if (item.failureStep !== undefined) {
          const step = object(item.failureStep, "proof report flow failureStep");
          failureStep = {
            index: finiteNumber(step.index, "proof report failureStep index"),
            total: finiteNumber(step.total, "proof report failureStep total"),
            label: requiredString(step.label, "proof report failureStep label"),
          };
        }
        let sharePath: string | undefined;
        if (item.sharePath !== undefined) {
          sharePath = requiredString(item.sharePath, "proof report flow sharePath");
        }
        return {
          testId: item.testId,
          title: item.title,
          status: item.status,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(failureDigest !== undefined ? { failureDigest } : {}),
          ...(failureStep !== undefined ? { failureStep } : {}),
          ...(sharePath !== undefined ? { sharePath } : {}),
        };
      }),
      ...(input.relayServerUrl !== undefined
        ? { relayServerUrl: requiredString(input.relayServerUrl, "proof report relayServerUrl") }
        : {}),
      generatedAt: input.generatedAt,
    };
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
