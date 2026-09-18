import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidenceAnalysisReport, ModelDecisionRecord } from "@relay/protocol";
import {
  evidenceTriageRequest,
  triageEvidenceReport,
  type ModelDecisionProvider,
} from "./index.js";

function report(): CombineEvidenceAnalysisReport {
  return {
    schemaVersion: 1,
    batchId: "batch-1",
    locales: ["en", "pt-BR"],
    coverage: { frames: 4, inspectedFrames: 4 },
    analysis: {
      schemaVersion: 1,
      sessionId: "batch-1",
      generatedAt: 100,
      baselineLocale: "en",
      critical: 1,
      warnings: 1,
      affectedScreens: 2,
      findings: [
        {
          id: "finding-critical",
          code: "PRODUCT_ASSERTION",
          severity: "critical",
          confidence: "high",
          canonicalKey: "frame-001",
          screenLabel: "Seats",
          locale: "pt-BR",
          baselineLocale: "en",
          detail: "Seats showed the wrong value.",
        },
        {
          id: "finding-warning",
          code: "POSSIBLE_UNTRANSLATED_TEXT",
          severity: "warning",
          confidence: "medium",
          canonicalKey: "frame-002",
          screenLabel: "Settings",
          locale: "pt-BR",
          baselineLocale: "en",
          detail: "A label may not be translated.",
        },
      ],
    },
    cases: [],
  };
}

function decision(answer: string): ModelDecisionRecord {
  return {
    schemaVersion: 1,
    status: "ok",
    provider: "openrouter",
    model: "~typesafe/jev-latest",
    requestId: "decision-1",
    startedAt: 100,
    completedAt: 110,
    durationMs: 10,
    evidenceRefs: ["combine:batch-1"],
    answers: {
      review_scope: {
        type: "choice",
        choice: answer,
        probabilities: { critical: 1, blocked: 0, warnings: 0, all: 0, none: 0 },
        confidence: 1,
      },
    },
  };
}

test("evidence triage projects saved findings and never changes the report", async () => {
  const original = report();
  let received: ReturnType<typeof evidenceTriageRequest> | undefined;
  const provider: ModelDecisionProvider = {
    id: "openrouter",
    async decide(request) {
      received = request;
      return decision("critical");
    },
  };

  const triage = await triageEvidenceReport(original, provider);

  assert.deepEqual(triage.findingIds, ["finding-critical"]);
  assert.equal(triage.status, "suggested");
  assert.equal(original.jevTriage, undefined);
  assert.equal(received?.state && JSON.stringify(received.state).includes("Seats"), true);
  assert.equal(received?.evidenceRefs?.[0], "combine:batch-1");
});

test("evidence triage preserves provider unavailability as an honest suggestion status", async () => {
  const provider: ModelDecisionProvider = {
    id: "openrouter",
    async decide(request) {
      return {
        ...decision("none"),
        status: "unavailable",
        model: request.model,
        answers: undefined,
        error: { code: "provider-unavailable", message: "missing key" },
      };
    },
  };

  const triage = await triageEvidenceReport(report(), provider);

  assert.equal(triage.status, "unavailable");
  assert.deepEqual(triage.findingIds, []);
  assert.match(triage.rationale, /missing key/u);
});
