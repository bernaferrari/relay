import assert from "node:assert/strict";
import test from "node:test";
import {
  compactExecutionDestIdentityFallback,
  summarizeExecutionOperationResult,
} from "./execution-summary.js";
import { CAPTURE_REVIEW_DEST_PHASE } from "./capture-review.js";

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

test("run.get dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.get", {
    run: {
      id: "4b93702b-d2cc-4db6-83ff-800380a3b284",
      status: "ok",
      action: "app-map:grok-web:test:test-grok-web-signed-in-home:root:r937",
      title: "Open grok.com signed-in",
      frames: [
        { path: "frames/003.png", caption: "step:step-observe:Observe" },
        { path: "frames/004.png", caption: "after · Run saved Test" },
      ],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "step:step-observe:Observe",
            lookFor: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            policy: "fast",
            status: "pending",
            configuration: {
              app: "Grok.com",
              account: "Bernardo Ferrari",
              browser: "chromium",
              viewport: "1280×800",
              locale: "en-US",
            },
            observed: {
              laneId: "grok-lab",
              profileId: "browser:grok-com-1280x800-339a5a430a41",
              sessionStore: "playwright-user-data",
            },
          },
        },
        {
          kind: "capture-review",
          data: {
            caption: "Close",
            framePath: "frames/004.png",
          },
        },
      ],
      recipeSnapshot: {
        steps: Array.from({ length: 40 }, (_, index) => ({ id: `step-${index}` })),
      },
    },
  }) as {
    run?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{
        framePath?: string;
        phase?: string;
        configuration?: { account?: string; app?: string };
        observed?: { laneId?: string };
      }>;
      frameCount?: number;
      recipeSnapshot?: unknown;
    };
  };
  assert.deepEqual(
    result.run?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.run?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
  assert.equal(result.run?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.equal(result.run?.captureReview?.[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(result.run?.captureReview?.[0]?.configuration?.account, "Bernardo Ferrari");
  assert.equal(result.run?.captureReview?.[0]?.configuration?.app, "Grok.com");
  assert.equal(result.run?.captureReview?.[0]?.observed?.laneId, "grok-lab");
  assert.equal(result.run?.frameCount, 2);
  assert.equal(result.run?.recipeSnapshot, undefined);
});

test("run.get compact capture-review drops SuperGrok stand-in account, keeps fixture id", () => {
  const labFixture = "authfx:7189423f-193e-45ed-b674-154505cc5107:1";
  const spoofed = summarizeExecutionOperationResult("run.get", {
    run: {
      id: "spoofed-supergrok",
      status: "ok",
      frames: [{ path: "frames/003.png", caption: "Observe" }],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            status: "pending",
            configuration: { account: "SuperGrok lab signed-in", app: "Grok.com" },
          },
        },
      ],
    },
  }) as {
    run?: { captureReview?: Array<{ configuration?: { account?: string; app?: string } }> };
  };
  assert.equal(spoofed.run?.captureReview?.[0]?.configuration?.account, undefined);
  assert.equal(spoofed.run?.captureReview?.[0]?.configuration?.app, "Grok.com");

  const fixture = summarizeExecutionOperationResult("run.get", {
    run: {
      id: "fixture-account",
      status: "ok",
      frames: [{ path: "frames/003.png", caption: "Observe" }],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            status: "pending",
            configuration: { account: labFixture, app: "Grok.com" },
          },
        },
      ],
    },
  }) as {
    run?: { captureReview?: Array<{ configuration?: { account?: string } }> };
  };
  assert.equal(fixture.run?.captureReview?.[0]?.configuration?.account, labFixture);
});

test("run.get compact drops device-observed signed-out, keeps browser signed-out", () => {
  const device = summarizeExecutionOperationResult("run.get", {
    run: {
      id: "5e2dca45-ece2-46f5-a8b1-cb4de7526338",
      status: "ok",
      frames: [{ path: "frames/003.png", caption: "Observe" }],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            status: "pending",
            configuration: { account: "signed-out", app: "iPad Pro 10.5" },
            observed: {
              laneId: "grok-ios-daily",
              profileId: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
            },
          },
        },
      ],
    },
  }) as {
    run?: {
      captureReview?: Array<{
        configuration?: { account?: string; app?: string };
        observed?: { laneId?: string; profileId?: string; iosHardwareClass?: string };
      }>;
    };
  };
  assert.equal(device.run?.captureReview?.[0]?.configuration?.account, undefined);
  assert.equal(device.run?.captureReview?.[0]?.observed?.iosHardwareClass, "physical-ipad");
  assert.equal(device.run?.captureReview?.[0]?.configuration?.app, "iPad Pro 10.5");
  assert.equal(device.run?.captureReview?.[0]?.observed?.laneId, "grok-ios-daily");
  assert.equal(
    device.run?.captureReview?.[0]?.observed?.profileId,
    "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
  );

  const browser = summarizeExecutionOperationResult("run.get", {
    run: {
      id: "unsigned-browser",
      status: "ok",
      frames: [{ path: "frames/003.png", caption: "Observe" }],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            status: "pending",
            configuration: { account: "signed-out", app: "Grok.com" },
            observed: {
              laneId: "grok-daily",
              profileId: "browser:grok-com-1280x800-339a5a430a41",
            },
          },
        },
      ],
    },
  }) as {
    run?: { captureReview?: Array<{ configuration?: { account?: string } }> };
  };
  assert.equal(browser.run?.captureReview?.[0]?.configuration?.account, "signed-out");
});

test("run.capture.review dest identity omits leftover Close last-frame", () => {
  const result = summarizeExecutionOperationResult("run.capture.review", {
    run: {
      id: "4b93702b",
      frames: [
        { path: "frames/003.png", caption: "Observe" },
        { path: "frames/004.png", caption: "after · Run saved Test" },
      ],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            policy: "fast",
          },
        },
      ],
    },
    queue: {
      items: [
        {
          captureId: "frames/003.png::dest",
          caption: "Observe",
          status: "pending",
          framePath: "frames/003.png",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
        {
          captureId: "frames/004.png::close-leftover",
          caption: "Close",
          status: "pending",
          framePath: "frames/004.png",
        },
      ],
      summary: { pending: 2 },
    },
    decision: { captureId: "frames/003.png::dest", action: "accept" },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    queue?: { items?: Array<{ framePath?: string }> };
    run?: unknown;
  };
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.queue?.items?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
  assert.equal(result.run, undefined);
});

test("run.evidence.get dest identity drops leftover 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.evidence.get", {
    evidence: {
      runId: "4b93702b",
      schemaVersion: 1,
      artifacts: [
        {
          kind: "capture-review",
          data: { framePath: "frames/003.png", phase: CAPTURE_REVIEW_DEST_PHASE },
        },
      ],
      testStepEvidence: [
        { testStepId: "step-observe", evidence: { framePaths: ["frames/003.png"] } },
        { testStepId: "step-observe", evidence: { framePaths: ["frames/004.png"] } },
      ],
      events: Array.from({ length: 200 }, (_, index) => ({ id: `event-${index}` })),
    },
  }) as {
    evidence?: {
      destIdentity?: Array<{ path?: string }>;
      testStepEvidence?: Array<{ evidence?: { framePaths?: string[] } }>;
      events?: unknown;
    };
  };
  assert.deepEqual(result.evidence?.destIdentity, [{ path: "frames/003.png" }]);
  assert.equal(
    result.evidence?.testStepEvidence?.some((item) =>
      item.evidence?.framePaths?.includes("frames/004.png"),
    ),
    false,
  );
  assert.equal(result.evidence?.events, undefined);
});

test("run.evidence.get unphased drops leftover Transition executed / Inspect setup skipped", () => {
  const result = summarizeExecutionOperationResult("run.evidence.get", {
    evidence: {
      runId: "unphased-transition",
      schemaVersion: 1,
      frames: [
        { path: "frames/002.png", caption: "after · Transition executed" },
        { path: "frames/003.png", caption: "after · Observe" },
        {
          path: "frames/004.png",
          caption: "after · Inspect setup skipped — already on this view",
        },
      ],
      artifacts: [],
      testStepEvidence: [
        { testStepId: "step-transition", evidence: { framePaths: ["frames/002.png"] } },
        { testStepId: "step-observe", evidence: { framePaths: ["frames/003.png"] } },
        { testStepId: "step-inspect", evidence: { framePaths: ["frames/004.png"] } },
      ],
    },
  }) as {
    evidence?: {
      destIdentity?: Array<{ path?: string; caption?: string }>;
      testStepEvidence?: Array<{
        testStepId?: string;
        evidence?: { framePaths?: string[] };
      }>;
    };
  };
  assert.deepEqual(result.evidence?.destIdentity, [
    { path: "frames/003.png", caption: "after · Observe" },
  ]);
  assert.deepEqual(
    result.evidence?.testStepEvidence?.map((item) => item.testStepId),
    ["step-observe"],
  );
  assert.equal(
    result.evidence?.testStepEvidence?.some((item) =>
      item.evidence?.framePaths?.some(
        (path) => path === "frames/002.png" || path === "frames/004.png",
      ),
    ),
    false,
  );
});

test("run.evidence.get drops opener Tap beside leftover Transition when dest-phase slim data absent", () => {
  const result = summarizeExecutionOperationResult("run.evidence.get", {
    evidence: {
      runId: "ios-sidebar-stripped",
      schemaVersion: 1,
      frames: [
        { path: "frames/001.png", caption: "before · Tap identifier sidebar.open.button" },
        { path: "frames/002.png", caption: "after · Transition executed" },
        { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
        { path: "frames/004.png", caption: "after · Transition executed" },
      ],
      artifacts: [{ kind: "capture-review", capturedAt: 1 }],
      testStepEvidence: [
        { testStepId: "step-tap", evidence: { framePaths: ["frames/001.png"] } },
        { testStepId: "step-transition", evidence: { framePaths: ["frames/002.png"] } },
        { testStepId: "step-observe", evidence: { framePaths: ["frames/003.png"] } },
        { testStepId: "step-leftover", evidence: { framePaths: ["frames/004.png"] } },
      ],
    },
  }) as {
    evidence?: {
      destIdentity?: Array<{ path?: string; caption?: string }>;
      testStepEvidence?: Array<{
        testStepId?: string;
        evidence?: { framePaths?: string[] };
      }>;
    };
  };
  assert.deepEqual(result.evidence?.destIdentity, [
    { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
  ]);
  assert.deepEqual(
    result.evidence?.testStepEvidence?.map((item) => item.testStepId),
    ["step-observe"],
  );
  assert.equal(
    result.evidence?.testStepEvidence?.some((item) =>
      item.evidence?.framePaths?.includes("frames/001.png"),
    ),
    false,
  );
});

test("run.evidence.get keeps slim capture-review dest-phase over opener Tap frames", () => {
  const result = summarizeExecutionOperationResult("run.evidence.get", {
    evidence: {
      runId: "ios-sidebar-slim",
      schemaVersion: 1,
      frames: [
        { path: "frames/001.png", caption: "before · Tap identifier sidebar.open.button" },
        { path: "frames/002.png", caption: "after · Transition executed" },
        { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
        { path: "frames/004.png", caption: "after · Transition executed" },
      ],
      artifacts: [
        {
          kind: "capture-review",
          capturedAt: 1,
          data: {
            phase: "dest",
            framePath: "frames/003.png",
            caption: "step:step-action:Sidebar open-close",
          },
        },
      ],
    },
  }) as {
    evidence?: { destIdentity?: Array<{ path?: string; caption?: string }> };
  };
  assert.deepEqual(result.evidence?.destIdentity, [
    { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
  ]);
});

test("run.evidence.get unphased Android dest-wait omits destIdentity", () => {
  const result = summarizeExecutionOperationResult("run.evidence.get", {
    evidence: {
      runId: "android-unphased",
      schemaVersion: 1,
      frames: [
        { path: "frames/001.png", caption: "before · wait for dest" },
        { path: "frames/002.png", caption: "after · wait for dest" },
      ],
      artifacts: [],
      testStepEvidence: [
        {
          testStepId: "step-wait",
          evidence: { framePaths: ["frames/001.png", "frames/002.png"] },
        },
      ],
    },
  }) as {
    evidence?: {
      destIdentity?: Array<{ path?: string }>;
      testStepEvidence?: Array<{ evidence?: { framePaths?: string[] } }>;
    };
  };
  assert.equal(result.evidence?.destIdentity, undefined);
  assert.deepEqual(result.evidence?.testStepEvidence?.[0]?.evidence?.framePaths, [
    "frames/001.png",
    "frames/002.png",
  ]);
});

test("job.get dest identity is dest wait-for, not leftover last-frame", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "4b93702b",
      status: "ok",
      frames: [
        { path: "frames/003.png", caption: "Observe" },
        { path: "frames/004.png", caption: "after · Run saved Test" },
      ],
      artifacts: [
        {
          kind: "capture-review",
          data: {
            caption: "Observe",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            policy: "fast",
          },
        },
      ],
    },
  }) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("Plan capture review summary keeps dest wait-for, not leftover Close last-frame", () => {
  const result = summarizeExecutionOperationResult("job.combine.capture.review", {
    queue: {
      items: [
        {
          captureId: "frames/003.png::dest",
          caption: "Observe",
          status: "pending",
          framePath: "frames/003.png",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
        {
          captureId: "frames/004.png::close-leftover",
          caption: "Close",
          status: "pending",
          framePath: "frames/004.png",
        },
      ],
      summary: { planned: 1, pending: 2 },
    },
  }) as {
    destIdentity?: Array<{ path?: string; caption?: string }>;
    queue?: { items?: Array<{ framePath?: string; phase?: string }> };
  };
  assert.deepEqual(result.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(result.queue?.items?.length, 1);
  assert.equal(result.queue?.items?.[0]?.framePath, "frames/003.png");
  assert.equal(result.queue?.items?.[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
});

test("job.list dest identity is dest wait-for 003 when the HTTP summary omitted frames", () => {
  const result = summarizeExecutionOperationResult("job.list", {
    jobs: [
      {
        id: "4b93702b",
        status: "ok",
        action: "observe",
        queuedAt: 1,
        frameCount: 2,
        destIdentity: [{ path: "frames/003.png", caption: "Observe" }],
      },
    ],
  }) as { jobs?: Array<{ destIdentity?: Array<{ path?: string; caption?: string }> }> };
  assert.deepEqual(result.jobs?.[0]?.destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
});

test("run.story.get dest identity is dest wait-for, not leftover Close 004", () => {
  const result = summarizeExecutionOperationResult("run.story.get", {
    story: {
      runId: "4b93702b",
      title: "Open grok.com signed-in",
      summary: "2 reviewed beats",
      beats: [
        { kind: "dest-identity", text: "Dest wait-for Fast", evidence: "frames/003.png", at: 1 },
        { kind: "screenshot", text: "after · Run saved Test", evidence: "frames/004.png", at: 2 },
      ],
    },
  }) as {
    story?: {
      destIdentity?: Array<{ path?: string }>;
      beats?: Array<{ evidence?: string; kind?: string }>;
    };
  };
  assert.deepEqual(result.story?.destIdentity, [{ path: "frames/003.png" }]);
  assert.equal(
    result.story?.beats?.some((beat) => beat.evidence === "frames/004.png"),
    false,
  );
  assert.equal(
    result.story?.beats?.some((beat) => beat.kind === "dest-identity"),
    true,
  );
});

test("run.trace-pack.get dest identity is dest wait-for, not leftover Close 004", () => {
  const result = summarizeExecutionOperationResult("run.trace-pack.get", {
    tracePack: {
      digest: "sha256:abc",
      objects: [
        {
          kind: "frozen-run",
          path: "run.json",
          content: {
            frames: [
              { path: "frames/003.png", caption: "Observe" },
              { path: "frames/004.png", caption: "after · Run saved Test" },
            ],
            artifacts: [
              {
                kind: "capture-review",
                data: {
                  caption: "Observe",
                  framePath: "frames/003.png",
                  phase: CAPTURE_REVIEW_DEST_PHASE,
                  policy: "fast",
                },
              },
            ],
          },
        },
      ],
    },
  }) as { destIdentity?: Array<{ path?: string }>; tracePack?: { objects?: unknown[] } };
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.tracePack?.objects?.length, 1);
});

const leftoverDestEndJob = {
  id: "4b93702b",
  status: "ok",
  frames: [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "after · Run saved Test" },
  ],
  artifacts: [
    {
      kind: "capture-review",
      data: {
        caption: "Observe",
        framePath: "frames/003.png",
        phase: CAPTURE_REVIEW_DEST_PHASE,
        policy: "fast",
      },
    },
    {
      kind: "capture-review",
      data: { caption: "Close", framePath: "frames/004.png" },
    },
  ],
};

test("app-map.test.run dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("app-map.test.run", {
    workflowId: "wf-1",
    job: leftoverDestEndJob,
  }) as {
    workflowId?: string;
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(result.workflowId, "wf-1");
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("workflow.transition dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("workflow.transition", {
    workflow: { workflowId: "wf-1", status: "terminal" },
    job: leftoverDestEndJob,
  }) as {
    workflow?: { workflowId?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(result.workflow?.workflowId, "wf-1");
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("run.replay dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.replay", {
    job: leftoverDestEndJob,
  }) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("app-map.connection.run dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("app-map.connection.run", {
    plan: { appMapId: "grok-web", connectionId: "open-home" },
    job: leftoverDestEndJob,
    jobs: [leftoverDestEndJob],
  }) as {
    plan?: { appMapId?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
    jobs?: Array<{ destIdentity?: Array<{ path?: string }> }>;
  };
  assert.equal(result.plan?.appMapId, "grok-web");
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("run.visual.compare dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.visual.compare", {
    comparison: {
      id: "visual-comparison-leftover",
      code: "VISUAL_BASELINE_MISSING",
      latest: {
        runId: leftoverDestEndJob.id,
        frameCount: 2,
        frames: [
          { path: "frames/003.png", caption: "Observe", index: 0 },
          { path: "frames/004.png", caption: "after · Run saved Test", index: 1 },
        ],
      },
      diff: {
        latestFrameCount: 2,
        frames: [
          { index: 0, code: "FRAME_ADDED", latest: { path: "frames/003.png" } },
          { index: 1, code: "FRAME_ADDED", latest: { path: "frames/004.png" } },
        ],
      },
    },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    comparison?: {
      latest?: { frameCount?: number; frames?: Array<{ path?: string }> };
      diff?: { frames?: Array<{ latest?: { path?: string } }> };
    };
  };
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    result.comparison?.latest?.frames?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.comparison?.latest?.frameCount, 1);
  assert.equal(
    result.comparison?.diff?.frames?.some((frame) => frame.latest?.path === "frames/004.png"),
    false,
  );
});

test("run.visual.review dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.visual.review", {
    comparison: {
      id: "visual-comparison-leftover",
      latest: {
        frames: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "after · Run saved Test" },
        ],
      },
    },
    decision: { action: "keep-baseline" },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    comparison?: { latest?: { frames?: Array<{ path?: string }> } };
    decision?: { action?: string };
  };
  assert.equal(result.decision?.action, "keep-baseline");
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.comparison?.latest?.frames?.some((frame) => frame.path === "frames/004.png"),
    false,
  );
});

test("run.visual-baseline.update never accepts leftover Close 004 as dest", () => {
  const result = summarizeExecutionOperationResult("run.visual-baseline.update", {
    comparison: {
      latest: {
        frames: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "Close" },
        ],
      },
    },
    decision: { action: "approve-new-baseline" },
    baseline: {
      id: "visual-baseline-leftover",
      approved: {
        frames: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "after · Run saved Test" },
        ],
      },
    },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    comparison?: { latest?: { frames?: Array<{ path?: string }> } };
    baseline?: { approved?: { frames?: Array<{ path?: string }> } };
    decision?: { action?: string };
  };
  assert.equal(result.decision?.action, "approve-new-baseline");
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.comparison?.latest?.frames?.some((frame) => frame.path === "frames/004.png"),
    false,
  );
  assert.equal(
    result.baseline?.approved?.frames?.some((frame) => frame.path === "frames/004.png"),
    false,
  );
});

test("job.combine.analysis dest identity drops leftover Close 004 finding frames", () => {
  const result = summarizeExecutionOperationResult("job.combine.analysis", {
    batchId: "dest-004",
    locales: ["en"],
    coverage: { frames: 2, inspectedFrames: 2 },
    cases: [
      {
        jobId: leftoverDestEndJob.id,
        locale: "en",
        status: "ok",
        frames: [
          {
            framePath: "frames/003.png",
            caption: "Observe",
            canonicalKey: "frame-001",
            inspected: true,
          },
          {
            framePath: "frames/004.png",
            caption: "after · Run saved Test",
            canonicalKey: "frame-002",
            inspected: true,
          },
        ],
      },
    ],
    analysis: {
      baselineLocale: "en",
      critical: 0,
      warnings: 1,
      affectedScreens: 1,
      findings: [
        {
          id: "finding-dest",
          code: "POSSIBLE_TEXT_CLIPPED",
          locale: "en",
          canonicalKey: "frame-001",
        },
        {
          id: "finding-leftover",
          code: "POSSIBLE_UNTRANSLATED_TEXT",
          locale: "en",
          canonicalKey: "frame-002",
        },
      ],
    },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    cases?: Array<{ frameCount?: number }>;
    analysis?: { findings?: Array<{ frame?: string }> };
  };
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.cases?.[0]?.frameCount, 1);
  assert.equal(
    result.analysis?.findings?.some((finding) => finding.frame === "frames/004.png"),
    false,
  );
  assert.equal(result.analysis?.findings?.[0]?.frame, "frames/003.png");
});

test("combine campaign get keeps campaign; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("job.combine.campaign.get", {
    campaign: { id: "camp-1", status: "ready-to-resume" },
  }) as {
    campaign?: { id?: string; status?: string };
    job?: unknown;
    destIdentity?: unknown;
  };
  assert.equal(result.campaign?.id, "camp-1");
  assert.equal(result.campaign?.status, "ready-to-resume");
  assert.equal(result.job, undefined);
  assert.equal(result.destIdentity, undefined);
});

test("combine campaign resume dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("job.combine.campaign.resume", {
    campaign: { id: "camp-1", status: "running" },
    jobs: [leftoverDestEndJob],
    cells: [{ cellId: "cell-1" }],
    admission: { admitted: true },
  }) as {
    campaign?: { id?: string };
    cells?: Array<{ cellId?: string }>;
    admission?: { admitted?: boolean };
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.equal(result.campaign?.id, "camp-1");
  assert.equal(result.cells?.[0]?.cellId, "cell-1");
  assert.equal(result.admission?.admitted, true);
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("combine campaign repeat clusters keep campaign id; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("job.combine.campaign.repeat.clusters", {
    schemaVersion: 1,
    campaignId: "camp-1",
    clusters: [
      {
        id: "cluster-1",
        cases: [{ runId: leftoverDestEndJob.id, evidenceRefs: ["run:4b93702b"] }],
      },
    ],
  }) as {
    campaignId?: string;
    clusters?: Array<{ id?: string; cases?: Array<{ evidenceRefs?: string[] }> }>;
  };
  assert.equal(result.campaignId, "camp-1");
  assert.equal(result.clusters?.[0]?.id, "cluster-1");
  assert.deepEqual(result.clusters?.[0]?.cases?.[0]?.evidenceRefs, ["run:4b93702b"]);
});

test("combine export dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("job.combine.export", {
    rootDir: "/tmp/pack",
    jobIds: [leftoverDestEndJob.id],
    manifest: {
      batchId: "dest-004",
      title: "Dest identity",
      locales: ["en"],
      generatedAt: 5,
      cases: [
        {
          locale: "en",
          jobId: leftoverDestEndJob.id,
          status: "ok",
          frames: leftoverDestEndJob.frames,
        },
      ],
      byCanonicalKey: {
        "frame-dest": { en: "frames/003.png" },
        "frame-leftover": { en: "frames/004.png" },
      },
      analysis: {
        baselineLocale: "en",
        critical: 0,
        warnings: 2,
        affectedScreens: 1,
        findings: [
          {
            id: "finding-dest",
            code: "POSSIBLE_TEXT_CLIPPED",
            locale: "en",
            canonicalKey: "frame-dest",
          },
          {
            id: "finding-leftover",
            code: "POSSIBLE_UNTRANSLATED_TEXT",
            locale: "en",
            canonicalKey: "frame-leftover",
          },
        ],
      },
    },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    manifest?: {
      cases?: Array<{ frameCount?: number }>;
      analysis?: { findings?: Array<{ frame?: string }> };
    };
  };
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.manifest?.cases?.[0]?.frameCount, 1);
  assert.equal(
    result.manifest?.analysis?.findings?.some((finding) => finding.frame === "frames/004.png"),
    false,
  );
  assert.equal(result.manifest?.analysis?.findings?.[0]?.frame, "frames/003.png");
});

test("combine start keeps campaign; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("job.combine.start", {
    campaign: { id: "camp-1", status: "running" },
    cells: [{ cellId: "cell-1" }],
    admission: { admitted: true },
    selectedCellIds: ["cell-1"],
    jobs: [leftoverDestEndJob],
  }) as {
    campaign?: { id?: string };
    cells?: Array<{ cellId?: string }>;
    admission?: { admitted?: boolean };
    selectedCellIds?: string[];
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.equal(result.campaign?.id, "camp-1");
  assert.equal(result.cells?.[0]?.cellId, "cell-1");
  assert.equal(result.admission?.admitted, true);
  assert.deepEqual(result.selectedCellIds, ["cell-1"]);
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("attached-job envelope top-level destIdentity drops leftover Close 004", () => {
  for (const operationId of [
    "job.combine.start",
    "job.combine.campaign.get",
    "job.combine.campaign.resume",
    "job.combine.campaign.cancel",
    "job.combine.campaign.triage",
    "job.retry",
    "job.active.cancel",
    "app-map.test.run",
    "run.repair.retry",
  ] as const) {
    const result = summarizeExecutionOperationResult(operationId, {
      campaign: { id: "camp-1", status: "running" },
      workflowId: "wf-1",
      jobs: [leftoverDestEndJob],
      job: leftoverDestEndJob,
      destIdentity: [
        { path: "frames/003.png", caption: "Observe" },
        { path: "frames/004.png", caption: "Close" },
      ],
      captureReview: [
        {
          captureId: "frames/003.png::dest",
          caption: "Observe",
          status: "pending",
          framePath: "frames/003.png",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
        {
          captureId: "frames/004.png::close-leftover",
          caption: "Close",
          status: "pending",
          framePath: "frames/004.png",
        },
      ],
    }) as {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
      job?: { destIdentity?: Array<{ path?: string }> };
      jobs?: Array<{ destIdentity?: Array<{ path?: string }> }>;
    };
    assert.deepEqual(
      result.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
      operationId,
    );
    assert.equal(
      result.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
      operationId,
    );
    if (result.job) {
      assert.deepEqual(
        result.job.destIdentity?.map((frame) => frame.path),
        ["frames/003.png"],
        operationId,
      );
    }
    if (result.jobs) {
      assert.deepEqual(
        result.jobs[0]?.destIdentity?.map((frame) => frame.path),
        ["frames/003.png"],
        operationId,
      );
    }
  }
});

test("attached-job envelope top-level destIdentity drops opener Tap beside leftover Transition", () => {
  for (const operationId of [
    "app-map.test.run",
    "job.combine.start",
    "run.repair.retry",
  ] as const) {
    const result = summarizeExecutionOperationResult(operationId, {
      job: { id: "e79b55ac", status: "ok" },
      destIdentity: [
        { path: "frames/001.png", caption: "before · Tap identifier sidebar.open.button" },
        { path: "frames/002.png", caption: "after · Transition executed" },
        { path: "frames/003.png", caption: "step:step-action:Sidebar open-close" },
        { path: "frames/004.png", caption: "after · Transition executed" },
      ],
    }) as { destIdentity?: Array<{ path?: string; caption?: string }> };
    assert.deepEqual(
      result.destIdentity,
      [{ path: "frames/003.png", caption: "step:step-action:Sidebar open-close" }],
      operationId,
    );
  }
});

test("job matrix/soak dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  for (const operationId of [
    "job.matrix.start",
    "job.soak.start",
    "job.compatibility-matrix.start",
  ] as const) {
    const result = summarizeExecutionOperationResult(operationId, {
      matrix: { id: "matrix-1" },
      jobs: [leftoverDestEndJob],
      batchId: "batch-1",
      repetitions: 1,
    }) as {
      matrix?: { id?: string };
      batchId?: string;
      jobs?: Array<{
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      }>;
    };
    assert.equal(result.matrix?.id, "matrix-1");
    assert.deepEqual(
      result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
    );
    assert.equal(
      result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
    );
  }
});

test("job retry dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("job.retry", {
    job: leftoverDestEndJob,
  }) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("job start/pause/resume/cancel dest identity is dest wait-for, not leftover Close 004 last-frame", () => {
  for (const operationId of [
    "job.start",
    "job.pause",
    "job.resume",
    "job.cancel",
    "job.active.cancel",
  ] as const) {
    const result = summarizeExecutionOperationResult(operationId, {
      job: leftoverDestEndJob,
    }) as {
      job?: {
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      };
    };
    assert.deepEqual(
      result.job?.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
    );
    assert.equal(
      result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
    );
  }
});

test("run.repair.retry keeps repair; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("run.repair.retry", {
    repair: { schemaVersion: 1, id: "repair-1", source: { runId: leftoverDestEndJob.id } },
    job: leftoverDestEndJob,
  }) as {
    repair?: { id?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(result.repair?.id, "repair-1");
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("run.review dest identity is dest wait-for 003, not leftover Close 004 last-frame", () => {
  const result = summarizeExecutionOperationResult("run.review", {
    review: { status: "approved", action: "approve" },
    run: leftoverDestEndJob,
  }) as {
    review?: { status?: string };
    run?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(result.review?.status, "approved");
  assert.deepEqual(
    result.run?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.run?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("job.list leftover Close 004 cannot fill dest identity", () => {
  const result = summarizeExecutionOperationResult("job.list", {
    jobs: [leftoverDestEndJob],
  }) as {
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.jobs?.[0]?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.equal(
    result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("listed destIdentity leftover Close 004 cannot fill dest without dest-phase artifacts", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: leftoverDestEndJob.id,
      status: "ok",
      destIdentity: [
        { path: "frames/003.png", caption: "Observe" },
        { path: "frames/004.png", caption: "Close" },
      ],
    },
  }) as { job?: { destIdentity?: Array<{ path?: string; caption?: string }> } };
  assert.deepEqual(result.job?.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
});

test("app-map.flow.run keeps plan; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("app-map.flow.run", {
    plan: { appMapId: "map", appMapRevision: 1, connections: [{ id: "c1" }] },
    job: leftoverDestEndJob,
    jobs: [leftoverDestEndJob],
    matrix: { id: "matrix-1" },
  }) as {
    plan?: { appMapId?: string; connectionCount?: number; connections?: unknown };
    matrix?: { id?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
    jobs?: Array<{ destIdentity?: Array<{ path?: string }> }>;
  };
  assert.equal(result.plan?.appMapId, "map");
  assert.equal(result.plan?.connectionCount, 1);
  assert.equal(result.plan?.connections, undefined);
  assert.equal(result.matrix?.id, "matrix-1");
  assert.deepEqual(
    result.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
});

test("combine campaign cancel/triage keep campaign; leftover Close 004 cannot fill dest", () => {
  for (const operationId of [
    "job.combine.campaign.cancel",
    "job.combine.campaign.triage",
    "job.combine.campaign.repeat.active",
  ] as const) {
    const result = summarizeExecutionOperationResult(operationId, {
      campaign: { id: "camp-1", status: "cancelled" },
      jobs: [leftoverDestEndJob],
    }) as {
      campaign?: { id?: string };
      jobs?: Array<{
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      }>;
    };
    assert.equal(result.campaign?.id, "camp-1");
    assert.deepEqual(
      result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
    );
    assert.equal(
      result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
    );
  }
});

test("run.replay.offline keeps report; leftover Close 004 cannot fill dest", () => {
  const result = summarizeExecutionOperationResult("run.replay.offline", {
    report: {
      schemaVersion: 1,
      mode: "offline-evidence-replay",
      runId: leftoverDestEndJob.id,
      frames: leftoverDestEndJob.frames,
      artifacts: leftoverDestEndJob.artifacts,
    },
  }) as {
    destIdentity?: Array<{ path?: string }>;
    report?: {
      mode?: string;
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(result.report?.mode, "offline-evidence-replay");
  assert.deepEqual(
    result.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    result.report?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.report?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("run.list leftover Close 004 cannot fill dest identity", () => {
  const result = summarizeExecutionOperationResult("run.list", {
    runs: [
      {
        id: leftoverDestEndJob.id,
        destIdentity: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "Close" },
        ],
        captureReview: [
          {
            captureId: "frames/003.png::observe",
            caption: "Observe",
            status: "pending",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
          },
          {
            captureId: "frames/004.png::close-leftover",
            caption: "Close",
            status: "pending",
            framePath: "frames/004.png",
          },
        ],
      },
    ],
  }) as {
    runs?: Array<{
      destIdentity?: Array<{ path?: string; caption?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.deepEqual(result.runs?.[0]?.destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.ok(!result.runs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"));
});

test("run.list listed-only capture-review keeps live account without artifacts", () => {
  const result = summarizeExecutionOperationResult("run.list", {
    runs: [
      {
        id: "4b93702b-d2cc-4db6-83ff-800380a3b284",
        status: "ok",
        destIdentity: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "Close" },
        ],
        captureReview: [
          {
            captureId: "frames/003.png::observe",
            caption: "Observe",
            status: "pending",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            configuration: { account: "Bernardo Ferrari", app: "Grok.com" },
            observed: { laneId: "grok-lab" },
          },
          {
            captureId: "frames/004.png::close-leftover",
            caption: "Close",
            status: "pending",
            framePath: "frames/004.png",
            configuration: { account: "SuperGrok lab signed-in" },
          },
        ],
      },
    ],
  }) as {
    runs?: Array<{
      destIdentity?: Array<{ path?: string; caption?: string }>;
      captureReview?: Array<{
        framePath?: string;
        phase?: string;
        configuration?: { account?: string; app?: string };
        observed?: { laneId?: string };
      }>;
    }>;
  };
  assert.deepEqual(result.runs?.[0]?.destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.configuration?.account, "Bernardo Ferrari");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.configuration?.app, "Grok.com");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.observed?.laneId, "grok-lab");
  assert.ok(!result.runs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"));
});

test("job.list listed-only capture-review keeps live account without artifacts", () => {
  const result = summarizeExecutionOperationResult("job.list", {
    jobs: [
      {
        id: "4b93702b-d2cc-4db6-83ff-800380a3b284",
        status: "ok",
        destIdentity: [
          { path: "frames/003.png", caption: "Observe" },
          { path: "frames/004.png", caption: "Close" },
        ],
        captureReview: [
          {
            captureId: "frames/003.png::observe",
            caption: "Observe",
            status: "pending",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
            configuration: { account: "Bernardo Ferrari", app: "Grok.com" },
            observed: { laneId: "grok-lab" },
          },
          {
            captureId: "frames/004.png::close-leftover",
            caption: "Close",
            status: "pending",
            framePath: "frames/004.png",
            configuration: { account: "SuperGrok lab signed-in" },
          },
        ],
      },
    ],
  }) as {
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{
        framePath?: string;
        configuration?: { account?: string };
        observed?: { laneId?: string };
      }>;
    }>;
  };
  assert.deepEqual(
    result.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(result.jobs?.[0]?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.equal(result.jobs?.[0]?.captureReview?.[0]?.configuration?.account, "Bernardo Ferrari");
  assert.equal(result.jobs?.[0]?.captureReview?.[0]?.observed?.laneId, "grok-lab");
  assert.ok(!result.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"));
});

test("run.list compact capture-review keeps live account and observed lane", () => {
  const result = summarizeExecutionOperationResult("run.list", {
    runs: [
      {
        id: "4b93702b-d2cc-4db6-83ff-800380a3b284",
        status: "ok",
        frames: leftoverDestEndJob.frames,
        artifacts: [
          {
            kind: "capture-review",
            data: {
              caption: "Observe",
              framePath: "frames/003.png",
              phase: CAPTURE_REVIEW_DEST_PHASE,
              policy: "fast",
              status: "pending",
              configuration: {
                app: "Grok.com",
                account: "Bernardo Ferrari",
                browser: "chromium",
              },
              observed: {
                laneId: "grok-lab",
                profileId: "browser:grok-com-1280x800-339a5a430a41",
              },
            },
          },
          {
            kind: "capture-review",
            data: { caption: "Close", framePath: "frames/004.png" },
          },
        ],
        captureReview: [
          {
            captureId: "frames/004.png::close-leftover",
            caption: "Close",
            status: "pending",
            framePath: "frames/004.png",
            configuration: { account: "SuperGrok lab signed-in" },
          },
        ],
      },
    ],
  }) as {
    runs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{
        framePath?: string;
        phase?: string;
        configuration?: { account?: string; app?: string };
        observed?: { laneId?: string };
      }>;
    }>;
  };
  assert.deepEqual(
    result.runs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    result.runs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.framePath, "frames/003.png");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.phase, CAPTURE_REVIEW_DEST_PHASE);
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.configuration?.account, "Bernardo Ferrari");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.configuration?.app, "Grok.com");
  assert.equal(result.runs?.[0]?.captureReview?.[0]?.observed?.laneId, "grok-lab");
});

test("run.trace-pack.get pre-listed destIdentity leftover Close 004 cannot fill dest", () => {
  const destIdentity = [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "Close" },
  ];
  const result = summarizeExecutionOperationResult("run.trace-pack.get", {
    destIdentity,
    tracePack: {
      digest: "sha256:abc",
      objects: [
        {
          kind: "frozen-run",
          path: "run.json",
          content: { destIdentity },
        },
      ],
    },
  }) as { destIdentity?: Array<{ path?: string; caption?: string }> };
  assert.deepEqual(result.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
});

test("compact MCP fallback dest identity is dest wait-for 003, not leftover Close 004", () => {
  const compact = compactExecutionDestIdentityFallback({ job: leftoverDestEndJob }, "job.get") as {
    destIdentity?: Array<{ path?: string }>;
    job?: { destIdentity?: Array<{ path?: string }> };
  };
  assert.deepEqual(
    compact.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    compact.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback unwraps operator wait leftover Close 004 dest identity", () => {
  const compact = compactExecutionDestIdentityFallback({
    type: "result",
    ok: true,
    operationId: "job.get",
    result: summarizeExecutionOperationResult("job.get", { job: leftoverDestEndJob }),
  }) as {
    destIdentity?: Array<{ path?: string }>;
    job?: { destIdentity?: Array<{ path?: string }> };
  };
  assert.deepEqual(
    compact.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    compact.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback run.list leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      runs: [
        {
          id: leftoverDestEndJob.id,
          destIdentity: [
            { path: "frames/003.png", caption: "Observe" },
            { path: "frames/004.png", caption: "Close" },
          ],
        },
      ],
    },
    "run.list",
  ) as {
    runs?: Array<{ destIdentity?: Array<{ path?: string; caption?: string }> }>;
  };
  assert.deepEqual(compact.runs?.[0]?.destIdentity, [
    { path: "frames/003.png", caption: "Observe" },
  ]);
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback visual compare dest identity is dest wait-for 003, not leftover Close 004", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      comparison: {
        latest: {
          frames: [
            { path: "frames/003.png", caption: "Observe" },
            { path: "frames/004.png", caption: "after · Run saved Test" },
          ],
        },
      },
    },
    "run.visual.compare",
  ) as { destIdentity?: Array<{ path?: string; caption?: string }> };
  assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback visual review leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      comparison: {
        latest: {
          frames: leftoverDestEndJob.frames,
        },
      },
      decision: { action: "keep-baseline" },
    },
    "run.visual.review",
  ) as { destIdentity?: Array<{ path?: string }> };
  assert.deepEqual(
    compact.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback visual-baseline update leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      comparison: {
        latest: { frames: leftoverDestEndJob.frames },
        baseline: { approved: { frames: leftoverDestEndJob.frames } },
      },
      baseline: { approved: { frames: leftoverDestEndJob.frames } },
    },
    "run.visual-baseline.update",
  ) as { destIdentity?: Array<{ path?: string }> };
  assert.deepEqual(
    compact.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback findings leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      batchId: "dest-004",
      cases: [
        {
          frames: [
            { framePath: "frames/003.png", caption: "Observe" },
            { framePath: "frames/004.png", caption: "after · Run saved Test" },
          ],
        },
      ],
    },
    "job.combine.analysis",
  ) as { destIdentity?: Array<{ path?: string; caption?: string }> };
  assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback nested findings leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback({
    findings: {
      batchId: leftoverDestEndJob.id,
      destIdentity: leftoverDestEndJob.frames,
      cases: [
        {
          frames: [
            { framePath: "frames/003.png", caption: "Observe" },
            { framePath: "frames/004.png", caption: "after · Run saved Test" },
          ],
        },
      ],
    },
    export: {
      destIdentity: leftoverDestEndJob.frames,
      cases: [
        {
          frames: leftoverDestEndJob.frames,
        },
      ],
    },
  }) as {
    destIdentity?: Array<{ path?: string; caption?: string }>;
    findings?: { destIdentity?: Array<{ path?: string }> };
    export?: { destIdentity?: Array<{ path?: string }> };
  };
  assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.deepEqual(
    compact.findings?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    compact.export?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("compact MCP fallback capture-review queue leftover Close 004 cannot fill dest", () => {
  const compact = compactExecutionDestIdentityFallback(
    {
      queue: {
        items: [
          {
            captureId: "frames/003.png::dest",
            caption: "Observe",
            status: "pending",
            framePath: "frames/003.png",
            phase: CAPTURE_REVIEW_DEST_PHASE,
          },
          {
            captureId: "frames/004.png::close-leftover",
            caption: "Close",
            status: "pending",
            framePath: "frames/004.png",
          },
        ],
        summary: { planned: 1, pending: 2 },
      },
    },
    "job.combine.capture.review",
  ) as { destIdentity?: Array<{ path?: string; caption?: string }> };
  assert.deepEqual(compact.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(JSON.stringify(compact).includes("frames/004.png"), false);
});

test("run.capture.review dest identity keeps dest wait-for from queue when run dest is omitted", () => {
  const result = summarizeExecutionOperationResult("run.capture.review", {
    queue: {
      items: [
        {
          captureId: "frames/003.png::dest",
          caption: "Observe",
          status: "pending",
          framePath: "frames/003.png",
          phase: CAPTURE_REVIEW_DEST_PHASE,
        },
        {
          captureId: "frames/004.png::close-leftover",
          caption: "Close",
          status: "pending",
          framePath: "frames/004.png",
        },
      ],
    },
    decision: { captureId: "frames/003.png::dest", action: "accept" },
  }) as {
    destIdentity?: Array<{ path?: string; caption?: string }>;
    queue?: { items?: Array<{ framePath?: string }> };
  };
  assert.deepEqual(result.destIdentity, [{ path: "frames/003.png", caption: "Observe" }]);
  assert.equal(
    result.queue?.items?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});
