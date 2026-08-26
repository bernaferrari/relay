/**
 * Proof reports — the PR-check payload. A completed run is projected into a
 * versioned, verdict-bearing summary: `pass` proves the flow held, `fail`
 * names a product problem, and `unproven` means Relay could not execute
 * (no device, no build). Unproven is deliberately distinct from fail so a
 * missing capability never reads as a regression.
 */
import { createHash } from "node:crypto";
import type { ProofReport, ProofReportFlow, ProofVerdict } from "@relay/protocol";
import { failedStepFromTrace } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { redactText } from "./redaction.js";

export type ProofReportInput = {
  run: Pick<
    PersistedRun,
    "id" | "title" | "status" | "outcome" | "error" | "healed" | "healMessage"
  > & {
    durationMs?: number;
    steps?: PersistedRun["steps"];
    testId?: string;
    sourceRevision?: PersistedRun["sourceRevision"];
  };
  /** Relative share-report path for this run's signed link, when one exists. */
  sharePath?: string;
  /** Absolute origin of the Relay server that produced the proof. */
  relayServerUrl?: string;
  at?: number;
};

/** Bounded, redacted digest of why a flow failed. Stable across identical
 * failures so agents can dedupe; short enough to sit in a check-run line. */
function failureDigestFor(run: ProofReportInput["run"]): string | undefined {
  const source = [run.error, run.healMessage].find((value) => value?.trim());
  if (!source) return undefined;
  const headline = redactText(source.trim().replace(/\s+/gu, " ")).slice(0, 200);
  if (!headline) return undefined;
  return createHash("sha256").update(headline).digest("hex").slice(0, 16);
}

/** The verdict matrix. Executed-and-held (`passed`, `healed`) proves the
 * change. Executed-and-broken (`error`, `failure` outcomes) fails it.
 * Anything that could not execute — cancelled mid-run, still queued or
 * running, deferred to review, uncertain evidence — is unproven, not fail. */
export function proofVerdict(run: ProofReportInput["run"]): ProofVerdict {
  const executedAndHeld =
    run.outcome === "passed" || ((run.status === "ok" || run.status === "healed") && !run.error);
  if (executedAndHeld) return "pass";
  if (run.outcome === "product-failure" || run.outcome === "harness-failure") return "fail";
  if (
    (run.status === "error" || run.status === "failed") &&
    run.outcome !== "uncertain" &&
    run.outcome !== "cancelled"
  ) {
    return "fail";
  }
  return "unproven";
}

function flowFor(input: ProofReportInput): ProofReportFlow {
  const run = input.run;
  const failedStep = failedStepFromTrace({ steps: run.steps });
  return {
    testId: input.run.testId?.trim() || input.run.id,
    title: input.run.title?.trim() || input.run.id,
    status: run.status,
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    ...(() => {
      const digest = failureDigestFor(run);
      return digest ? { failureDigest: digest } : {};
    })(),
    ...(failedStep && proofVerdict(run) === "fail" ? { failureStep: failedStep } : {}),
    ...(input.sharePath ? { sharePath: input.sharePath } : {}),
  };
}

export function buildProofReport(input: ProofReportInput): ProofReport {
  const at = input.at ?? Date.now();
  const flow = flowFor(input);
  return {
    schemaVersion: 1,
    verdict: proofVerdict(input.run),
    ...(input.run.sourceRevision ? { sourceRevision: input.run.sourceRevision } : {}),
    flows: [flow],
    ...(input.relayServerUrl ? { relayServerUrl: input.relayServerUrl } : {}),
    generatedAt: at,
  };
}

/** Compact GitHub check-run markdown: one line per flow with an icon verdict,
 * title, duration, and share link path. Deterministic — no timestamps, no
 * locale formatting — so identical runs render byte-identical summaries. */
export function renderProofReportMarkdown(report: ProofReport): string {
  const icon = report.verdict === "pass" ? "✅" : report.verdict === "fail" ? "❌" : "⚠️";
  const lines = report.flows.map((flow) => {
    const parts = [`${icon} **${flow.title}**`];
    if (flow.durationMs !== undefined) parts.push(`${flow.durationMs}ms`);
    if (flow.failureStep) {
      parts.push(`stopped at step ${flow.failureStep.index + 1}/${flow.failureStep.total}`);
    }
    if (flow.sharePath) parts.push(`[proof](${flow.sharePath})`);
    return `- ${parts.join(" · ")}`;
  });
  lines.push("");
  lines.push(
    `Verdict: **${report.verdict}** (${report.flows.length} flow${report.flows.length === 1 ? "" : "s"})`,
  );
  return `${lines.join("\n")}\n`;
}
