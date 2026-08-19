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

test("a pack export hands back its findings with the frame each one came from", () => {
  const result = summarizeExecutionOperationResult("job.locale-matrix.export", {
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
  const result = summarizeExecutionOperationResult("job.locale-matrix.analysis", {
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
