import type { ServerConnection } from "@relay/protocol";
import type { ProductChangeDetails } from "@relay/product/change-journey";
import type { ProductBatchReport } from "@relay/product/run-across";
import type { ProductRunReportOverview } from "./run-product-service";
import type { Platform } from "../platform/types";

export type ProductIntegrationProvider = "relay" | "github" | "slack" | "webhook" | "ci";
export type ProductIntegrationState =
  | "connected"
  | "server-managed"
  | "unavailable"
  | "unsupported";

export type ProductIntegration = {
  readonly provider: ProductIntegrationProvider;
  readonly name: string;
  readonly state: ProductIntegrationState;
  readonly capabilities: readonly ("workspace" | "checks" | "proof-publication")[];
  readonly detail: string;
};

export type ProductIssueSource =
  | { readonly kind: "run"; readonly report: ProductRunReportOverview }
  | { readonly kind: "batch"; readonly report: ProductBatchReport }
  | { readonly kind: "change"; readonly details: ProductChangeDetails };

export type ProductIssueDraft = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly source: { readonly kind: ProductIssueSource["kind"]; readonly id: string };
  readonly labels: readonly string[];
  readonly evidence: {
    readonly available: boolean;
    readonly count: number;
  };
  readonly redaction: {
    readonly applied: boolean;
    readonly redactedFields: readonly string[];
  };
  /** No provider side effect is implied by composing a draft. */
  readonly delivery: {
    readonly state: "draft-only";
    readonly supportedMutation: false;
    readonly detail: string;
  };
};

export type IntegrationsProductService = {
  list(): Promise<readonly ProductIntegration[]>;
  composeIssue(source: ProductIssueSource): ProductIssueDraft;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 512) : "";
}

function bounded(values: readonly string[], limit = 20): string[] {
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .slice(0, limit);
}

function redact(value: string): { value: string; fields: string[] } {
  const fields = new Set<string>();
  let redacted = value.replace(
    /\b(token|secret|password|cookie|authorization|bearer|private[ _-]?key)\s*[:=]\s*([^\s,;]+)/giu,
    (_match, field: string) => {
      fields.add(field.toLocaleLowerCase());
      return `${field}=[redacted]`;
    },
  );
  redacted = redacted.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/giu, (_match, base: string) => {
    fields.add("url-query");
    return `${base}?[redacted]`;
  });
  return { value: redacted.slice(0, 8_192), fields: [...fields].sort() };
}

function linesForRun(report: ProductRunReportOverview): {
  id: string;
  lines: string[];
  count: number;
} {
  const failures = report.timeline.filter((item) => item.state === "failed");
  const lines = [
    `Run: ${clean(report.runId)}`,
    `Outcome: ${clean(report.outcome) || "unknown"}`,
    ...(clean(report.category) ? [`Category: ${clean(report.category)}`] : []),
    ...(clean(report.cause) ? [`Cause: ${clean(report.cause)}`] : []),
    ...(report.firstEvidence ? [`First evidence: ${clean(report.firstEvidence.label)}`] : []),
    ...(failures.length
      ? [`Failed steps: ${bounded(failures.map((item) => item.title)).join(", ")}`]
      : []),
    `Evidence channels: ${report.evidence.length}`,
  ];
  return { id: report.runId, lines, count: report.evidence.length };
}

function linesForBatch(report: ProductBatchReport): { id: string; lines: string[]; count: number } {
  const failed = report.cases
    .filter((item) => item.status === "failed" || item.status === "blocked")
    .slice(0, 20)
    .map((item) => `${clean(item.id)}${item.error ? `: ${clean(item.error)}` : ""}`);
  const lines = [
    `Batch: ${clean(report.id)}`,
    `Status: ${clean(report.status)}`,
    `Summary: ${clean(report.report.headline)}`,
    clean(report.report.detail),
    `Cases: ${report.completedCases}/${report.totalCases} completed`,
    ...(report.targetNames.length
      ? [`Environments: ${bounded(report.targetNames, 10).join(", ")}`]
      : []),
    ...(failed.length ? [`First failures: ${failed.join("; ")}`] : []),
  ].filter(Boolean);
  return { id: report.id, lines, count: report.runIds.length };
}

function linesForChange(details: ProductChangeDetails): {
  id: string;
  lines: string[];
  count: number;
} {
  const change = details.change;
  const lines = [
    `Change: ${clean(change.id)}`,
    `Status: ${clean(change.status)}`,
    ...(clean(change.baseRevision) ? [`Base revision: ${clean(change.baseRevision)}`] : []),
    ...(clean(change.requestedRevision)
      ? [`Requested revision: ${clean(change.requestedRevision)}`]
      : []),
    ...(details.firstFailure
      ? [
          `First failure: ${clean(details.firstFailure.summary)} (${clean(details.firstFailure.runId)})`,
        ]
      : []),
    ...(change.coverageGaps.length
      ? [`Coverage gaps: ${bounded(change.coverageGaps).join(", ")}`]
      : []),
    ...(change.residualRisk.length
      ? [`Residual risk: ${bounded(change.residualRisk).join(", ")}`]
      : []),
    `Publications: ${details.publications.length}`,
  ].filter(Boolean);
  return { id: change.id, lines, count: change.evidenceCount };
}

/** Compose a bounded, redacted handoff without constructing provider payloads. */
export function composeProductIssue(source: ProductIssueSource): ProductIssueDraft {
  const projection =
    source.kind === "run"
      ? linesForRun(source.report)
      : source.kind === "batch"
        ? linesForBatch(source.report)
        : linesForChange(source.details);
  const title =
    source.kind === "run"
      ? clean(source.report.title) || "Run failure"
      : source.kind === "batch"
        ? clean(source.report.title) || "Batch failure"
        : clean(source.details.change.title) || "Change verification issue";
  const safeTitle = redact(title);
  const result = redact([`# ${title}`, "", ...projection.lines].join("\n"));
  const redactedFields = [...new Set([...safeTitle.fields, ...result.fields])].sort();
  return {
    id: `issue-draft:${source.kind}:${projection.id}`,
    title: safeTitle.value,
    body: result.value,
    source: { kind: source.kind, id: projection.id },
    labels: ["relay", source.kind === "change" ? "verification" : "failure"],
    evidence: { available: projection.count > 0, count: projection.count },
    redaction: { applied: redactedFields.length > 0, redactedFields },
    delivery: {
      state: "draft-only",
      supportedMutation: false,
      detail: "Relay has no generic issue, Slack, or webhook delivery operation in this workspace.",
    },
  };
}

function workspaceIntegration(connection: ServerConnection | { url: string }): ProductIntegration {
  try {
    const host = new URL(connection.url).host || "workspace";
    return {
      provider: "relay",
      name: "Relay workspace",
      state: "connected",
      capabilities: ["workspace"],
      detail: `Connected to ${host}.`,
    };
  } catch {
    return {
      provider: "relay",
      name: "Relay workspace",
      state: "unavailable",
      capabilities: [],
      detail: "The configured Relay workspace address is unavailable.",
    };
  }
}

/**
 * Lists only what the current product boundary can prove. GitHub publication
 * is server-owned and may be configured through process authority; Slack,
 * webhook, and CI settings have no protocol operations yet.
 */
export function createIntegrationsProductService(platform: Platform): IntegrationsProductService {
  return {
    async list() {
      const connection = platform.getServerConnection
        ? await platform.getServerConnection()
        : { url: await platform.getServerUrl() };
      return [
        workspaceIntegration(connection),
        {
          provider: "github",
          name: "GitHub Checks",
          state: "server-managed",
          capabilities: ["checks", "proof-publication"],
          detail:
            "GitHub Proof publication is controlled by the Relay server; auth material is not exposed here.",
        },
        {
          provider: "slack",
          name: "Slack",
          state: "unsupported",
          capabilities: [],
          detail: "No Slack integration operation is available.",
        },
        {
          provider: "webhook",
          name: "Webhook",
          state: "unsupported",
          capabilities: [],
          detail: "No generic webhook integration operation is available.",
        },
        {
          provider: "ci",
          name: "CI/build ingestion",
          state: "server-managed",
          capabilities: [],
          detail:
            "Build ingestion is server-owned; no settings operation exposes its configuration.",
        },
      ];
    },
    composeIssue: composeProductIssue,
  };
}
