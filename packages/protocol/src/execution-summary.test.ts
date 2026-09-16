import assert from "node:assert/strict";
import test from "node:test";
import { summarizeExecutionOperationResult } from "./execution-summary.js";

test("job.get keeps a useful tail of logs for agents watching a tour", () => {
  const logs = Array.from({ length: 30 }, (_, index) => `tour → stop ${index + 1}`);
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      title: "Settings · depth 0",
      logs,
      lastLogs: logs.slice(-12),
      steps: [{ id: "s1", title: "Tour visible rows", status: "running" }],
    },
  }) as { job?: { logs?: string[]; lastLogs?: unknown; stepCount?: number } };

  assert.equal(result.job?.stepCount, 1);
  assert.deepEqual(result.job?.logs, logs.slice(-24));
  assert.equal(result.job?.logs?.at(-1), "tour → stop 30");
});

test("job.get falls back to lastLogs when the compact summary omitted the full ring", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      lastLogs: ["tour: 14 stop(s)", "tour → Appearance"],
    },
  }) as { job?: { logs?: string[] } };
  assert.deepEqual(result.job?.logs, ["tour: 14 stop(s)", "tour → Appearance"]);
});

test("standalone step keeps a terminal iOS review pointer for MCP callers", () => {
  const result = summarizeExecutionOperationResult("step.run", {
    ok: false,
    terminal: "review-needed",
    error: "The iOS press may already have reached the device.",
    durationMs: 12,
    logs: Array.from({ length: 30 }, (_, index) => `native log ${index + 1}`),
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    stepReview: {
      captureCurrent: {
        operationId: "target.screenshot.capture",
        input: { serial: "ipad-1" },
      },
    },
  }) as {
    terminal?: string;
    code?: string;
    logs?: string[];
    stepReview?: { captureCurrent?: { operationId?: string; input?: { serial?: string } } };
  };

  assert.equal(result.terminal, "review-needed");
  assert.equal(result.code, "IOS_MUTATION_OUTCOME_UNKNOWN");
  assert.deepEqual(
    result.logs,
    Array.from({ length: 24 }, (_, index) => `native log ${index + 7}`),
  );
  assert.deepEqual(result.stepReview, {
    captureCurrent: {
      operationId: "target.screenshot.capture",
      input: { serial: "ipad-1" },
    },
  });
});

test("a pack export hands back its findings with the frame each one came from", () => {
  const result = summarizeExecutionOperationResult("job.combine.export", {
    rootDir: "/tmp/pack",
    jobIds: ["job-en", "job-pt"],
    manifest: {
      schemaVersion: 2,
      batchId: "batch-1",
      title: "Settings · locales",
      locales: ["en", "pt-BR"],
      generatedAt: 5,
      cases: [
        {
          locale: "en",
          jobId: "job-en",
          status: "ok",
          name: "Settings · en",
          frames: ["en/1.png"],
        },
        {
          locale: "pt-BR",
          jobId: "job-pt",
          status: "ok",
          name: "Settings · pt-BR",
          frames: ["pt-br/1.png"],
          expectedFrames: 1,
        },
      ],
      byCanonicalKey: { "frame-001": { en: "en/1.png", "pt-BR": "pt-br/1.png" } },
      analysisCoverage: { frames: 2, inspectedFrames: 2 },
      analysis: {
        schemaVersion: 1,
        sessionId: "batch-1",
        generatedAt: 5,
        baselineLocale: "en",
        critical: 0,
        warnings: 1,
        affectedScreens: 1,
        findings: [
          {
            id: "finding-1",
            code: "POSSIBLE_UNTRANSLATED_TEXT",
            severity: "warning",
            confidence: "medium",
            canonicalKey: "frame-001",
            screenLabel: "Settings",
            locale: "pt-BR",
            baselineLocale: "en",
            detail: "“App Language” is unchanged from en on Settings.",
          },
        ],
      },
    },
  }) as {
    rootDir?: string;
    jobIds?: string[];
    manifest?: {
      locales?: string[];
      analysisCoverage?: { inspectedFrames?: number };
      cases?: Array<{ locale?: string; frameCount?: number }>;
      analysis?: { findingCount?: number; findings?: Array<{ code?: string; frame?: string }> };
    };
  };

  assert.equal(result.rootDir, "/tmp/pack");
  assert.deepEqual(result.jobIds, ["job-en", "job-pt"]);
  assert.deepEqual(result.manifest?.locales, ["en", "pt-BR"]);
  assert.equal(result.manifest?.analysisCoverage?.inspectedFrames, 2);
  assert.deepEqual(result.manifest?.cases?.[1], {
    locale: "pt-BR",
    status: "ok",
    frameCount: 1,
    expectedFrames: 1,
  });
  assert.equal(result.manifest?.analysis?.findingCount, 1);
  assert.equal(result.manifest?.analysis?.findings?.[0]?.code, "POSSIBLE_UNTRANSLATED_TEXT");
  assert.equal(result.manifest?.analysis?.findings?.[0]?.frame, "pt-br/1.png");
});

test("a live analysis reports verdicts and coverage without a frame list per case", () => {
  const result = summarizeExecutionOperationResult("job.combine.analysis", {
    schemaVersion: 1,
    batchId: "batch-1",
    locales: ["en", "pt-BR"],
    coverage: { frames: 2, inspectedFrames: 1 },
    cases: [
      {
        jobId: "job-en",
        locale: "en",
        status: "ok",
        frames: [{ framePath: "frames/001.png", canonicalKey: "frame-001", inspected: true }],
      },
      {
        jobId: "job-pt",
        locale: "pt-BR",
        status: "ok",
        frames: [{ framePath: "frames/001.png", canonicalKey: "frame-001", inspected: false }],
      },
    ],
    analysis: {
      schemaVersion: 1,
      sessionId: "batch-1",
      generatedAt: 5,
      baselineLocale: "en",
      critical: 0,
      warnings: 1,
      affectedScreens: 1,
      findings: [
        {
          id: "finding-1",
          code: "POSSIBLE_TEXT_CLIPPED",
          severity: "warning",
          confidence: "medium",
          canonicalKey: "frame-001",
          screenLabel: "Settings",
          locale: "pt-BR",
          baselineLocale: "en",
          detail: "“Idioma do aplicativo” no longer fits its control.",
        },
      ],
    },
  }) as {
    coverage?: { inspectedFrames?: number };
    cases?: Array<Record<string, unknown>>;
    analysis?: { findingCount?: number; findings?: Array<{ code?: string; frame?: string }> };
  };

  assert.equal(result.coverage?.inspectedFrames, 1);
  assert.deepEqual(result.cases?.[1], {
    jobId: "job-pt",
    locale: "pt-BR",
    status: "ok",
    frameCount: 1,
    inspectedFrames: 0,
  });
  assert.equal(result.analysis?.findingCount, 1);
  assert.equal(result.analysis?.findings?.[0]?.code, "POSSIBLE_TEXT_CLIPPED");
  assert.equal(result.analysis?.findings?.[0]?.frame, "frames/001.png");
});

test("Plan capture review keeps the queue instead of collapsing to an empty job summary", () => {
  const queue = {
    items: [
      {
        captureId: "frames/001.png::aaa",
        caption: "Settings",
        status: "pending",
        runId: "run-8",
        attempt: 2,
      },
    ],
    summary: {
      captured: 1,
      missing: 0,
      pending: 1,
      accepted: 0,
      issue: 0,
      needMoreEvidence: 0,
      planned: 1,
      blocked: 0,
    },
  };
  const listed = summarizeExecutionOperationResult("job.combine.capture.review", { queue }) as {
    queue?: { summary?: { planned?: number }; items?: Array<{ attempt?: number }> };
  };
  assert.equal(listed.queue?.summary?.planned, 1);
  assert.equal(listed.queue?.items?.[0]?.attempt, 2);
  const applied = summarizeExecutionOperationResult("job.combine.capture.review.apply", {
    queue,
    results: [{ runId: "run-8", captureId: "frames/001.png::aaa", status: "applied" }],
  }) as { results?: Array<{ status?: string }> };
  assert.equal(applied.results?.[0]?.status, "applied");
});

test("job.get retains bounded campaign outcomes and lineage", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      batchId: "campaign-1",
      caseIndex: 2,
      caseCount: 40,
      artifacts: [
        {
          kind: "campaign-check-result",
          data: {
            id: "settings",
            title: "Settings",
            status: "failed",
            error: "screen changed",
            startedAt: 100,
            finishedAt: 180,
          },
        },
        { kind: "screenshot", data: { base64: "must-not-leak" } },
      ],
    },
  }) as {
    job?: {
      batchId?: string;
      caseIndex?: number;
      caseCount?: number;
      checks?: Array<Record<string, unknown>>;
    };
  };

  assert.equal(result.job?.batchId, "campaign-1");
  assert.equal(result.job?.caseIndex, 2);
  assert.equal(result.job?.caseCount, 40);
  assert.deepEqual(result.job?.checks, [
    {
      id: "settings",
      title: "Settings",
      status: "failed",
      error: "screen changed",
      startedAt: 100,
      finishedAt: 180,
      durationMs: 80,
    },
  ]);
});

test("failed job summaries stay bounded and point to durable evidence and repairs", () => {
  const huge = "diagnostic ".repeat(100_000);
  const artifacts = Array.from({ length: 100 }, (_, index) => ({
    kind: "campaign-check-result",
    data: {
      id: `check-${index}`,
      title: `Check ${index}`,
      status: index === 0 ? "interrupted" : "failed",
      error: huge,
      startedAt: index,
      finishedAt: index + 1,
    },
  }));
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "failed-run",
      status: "error",
      error: huge,
      runDir: "/workspace/runs/failed-run",
      logs: Array.from({ length: 30 }, () => huge),
      steps: Array.from({ length: 30 }, (_, index) => ({
        id: `step-${index}`,
        title: `Step ${index}`,
        status: "error",
        log: huge,
      })),
      artifacts,
    },
  }) as {
    job?: {
      error?: string;
      checkCount?: number;
      checks?: Array<{ status?: string }>;
      failedSteps?: unknown[];
      resources?: { run?: string; runDir?: string; repairs?: string[] };
    };
  };

  assert.equal(result.job?.checkCount, 100);
  assert.equal(result.job?.checks?.length, 40);
  assert.equal(result.job?.checks?.[0]?.status, "interrupted");
  assert.equal(result.job?.failedSteps?.length, 12);
  assert.equal(result.job?.resources?.run, "/runs/failed-run");
  assert.equal(result.job?.resources?.runDir, "/workspace/runs/failed-run");
  assert.equal(result.job?.resources?.repairs?.length, 40);
  assert.ok((result.job?.error?.length ?? 0) <= 4_000);
  assert.ok(JSON.stringify(result).length < 75_000);
});

test("pack summaries expose duplicate counts and viewer path without dumping page text", () => {
  const summary = summarizeExecutionOperationResult("job.combine.export", {
    rootDir: "/tmp/pack",
    manifest: {
      cases: [],
      content: {
        method: "ordered-nfc-text-v1",
        inspectedPages: 4,
        uniquePages: 3,
        duplicateGroups: [["a", "b"]],
        pages: [{ text: "large captured content" }],
      },
    },
  }) as { manifest: { content: Record<string, unknown> } };
  assert.equal(summary.manifest.content.duplicateGroupCount, 1);
  assert.equal(summary.manifest.content.comparison, "comparison.html");
  assert.equal(summary.manifest.content.pages, undefined);
});
