import { describe, expect, it, vi } from "vitest";
import {
  findPersistedRunWorkflowId,
  framePathsForTraceStep,
  projectWorkflowlessExecution,
  projectRunReport,
  runOutcome,
} from "./run-product-service";

describe("run report projection", () => {
  it("does not report successful evidence capture as a passed blocked interaction", () => {
    const report = projectRunReport(
      "blocked-check",
      {
        artifacts: [
          { kind: "campaign-check-result", data: { id: "tap-network", status: "blocked" } },
        ],
        steps: [{ title: "Screenshot · step:tap-network:Tap Network", status: "ok" }],
      },
      { channels: {} },
    );
    expect(report.timeline[0]?.state).toBe("blocked");
  });
  it("keeps final capture evidence without inventing another authored step", () => {
    const report = projectRunReport(
      "authored-run",
      {
        artifacts: [{ kind: "campaign-check-result", data: { id: "tap", status: "passed" } }],
        steps: [
          { title: "Screenshot · step:tap:Tap Network", status: "ok" },
          {
            title: "Screenshot · final:Network tour",
            status: "ok",
            frames: [{ path: "frames/final.png" }],
          },
        ],
      },
      { channels: { screenshot: { entries: 1 } } },
    );
    expect(report.timeline.map((step) => step.title)).toEqual(["Tap Network"]);
    expect(report.evidence.find((section) => section.id === "screenshot")?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "frames/final.png" })]),
    );
  });
  it("projects workflow-less active jobs without inventing workflow identity", () => {
    const state = projectWorkflowlessExecution(
      {
        id: "run-live",
        status: "running",
        title: "CLI Test",
        progress: { label: "Tap", completed: 2, total: 4 },
      },
      "run-live",
    );
    expect(state.workflow).toBeUndefined();
    expect(state.snapshot).toMatchObject({
      phase: "running",
      progress: { label: "Tap", completed: 2, total: 4 },
      allowedNextActions: ["inspect", "cancel"],
    });
  });

  it("projects workflow-less terminal and cancelled jobs as terminal state", () => {
    expect(
      projectWorkflowlessExecution({ id: "run-ok", status: "ok" }, "run-ok").snapshot?.phase,
    ).toBe("succeeded");
    expect(
      projectWorkflowlessExecution({ id: "run-cancelled", status: "cancelled" }, "run-cancelled")
        .snapshot?.allowedNextActions,
    ).toEqual(["inspect"]);
  });

  it("follows run.list continuation pages and uses only the canonical workflowId", async () => {
    const calls: unknown[] = [];
    const client = {
      invoke: vi.fn(async (_id: string, input: unknown) => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            runs: [{ id: "other", workflowRequestId: "request-only" }],
            nextCursor: "page-2",
          };
        }
        return { runs: [{ id: "run-target", workflowId: "workflow-canonical" }] };
      }),
    } as never;
    await expect(findPersistedRunWorkflowId(client, "run-target")).resolves.toBe(
      "workflow-canonical",
    );
    expect(calls).toEqual([{}, { cursor: "page-2" }]);
  });

  it("reports unknown transport outcome categories once without exposing the raw value", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(runOutcome("unsupported-status")).toBeUndefined();
    expect(runOutcome("another-unsupported-status")).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[1]).toEqual({
      component: "OutcomeMark",
      reason: "unknown-outcome",
      category: "string",
    });
    expect(JSON.stringify(warning.mock.calls[0])).not.toContain("unsupported-status");
    warning.mockRestore();
  });

  it("joins frames by authoritative trace step index and never by array position", () => {
    const evidence = [
      {
        schemaVersion: 1 as const,
        testStepId: "a",
        recipeId: "r",
        recipeStepId: "a",
        traceStepId: "trace-a",
        traceStepIndex: 4,
        occurrence: 1,
        evidence: {
          framePaths: ["frames/a.png"],
          eventSequences: [],
          artifactKinds: ["screenshot"],
        },
      },
      {
        schemaVersion: 1 as const,
        testStepId: "b",
        recipeId: "r",
        recipeStepId: "b",
        traceStepId: "trace-b",
        traceStepIndex: 9,
        occurrence: 1,
        evidence: {
          framePaths: ["frames/b.png"],
          eventSequences: [],
          artifactKinds: ["screenshot"],
        },
      },
    ];
    expect(framePathsForTraceStep(evidence, 9)).toEqual(["frames/b.png"]);
    expect(framePathsForTraceStep(evidence, 1)).toEqual([]);
  });

  it("projects authored capture onto the visible screenshot leaf by test-step identity", () => {
    const report = projectRunReport(
      "run-localized",
      {
        steps: [
          {
            id: "trace-module",
            index: 0,
            title: "Run saved Test",
            status: "ok",
            frames: [{ path: "frames/002.png" }],
          },
          {
            id: "trace-shot",
            index: 1,
            title: "Screenshot · step:test-step:Tap Network",
            status: "ok",
            frames: [],
          },
        ],
        testStepEvidence: [
          {
            schemaVersion: 1,
            testStepId: "test-step",
            recipeId: "recipe",
            recipeStepId: "module",
            traceStepId: "trace-module",
            traceStepIndex: 0,
            occurrence: 1,
            evidence: {
              framePaths: ["frames/002.png"],
              eventSequences: [],
              artifactKinds: ["screenshot"],
            },
          },
        ],
      },
      { channels: { screenshot: { entries: 1 } } },
    );
    expect(report.timeline).toHaveLength(1);
    expect(report.timeline[0]?.framePaths).toEqual(["frames/002.png"]);
  });

  it("falls through an empty leaf trace row without crossing Test step identity", () => {
    const report = projectRunReport(
      "run-localized",
      {
        steps: [
          {
            id: "module-a",
            index: 0,
            title: "Run saved Test",
            status: "ok",
            frames: [{ path: "frames/a.png" }],
          },
          {
            id: "leaf-a",
            index: 1,
            title: "Screenshot · step:test-a:Tap Network",
            status: "ok",
            frames: [],
          },
          {
            id: "leaf-b",
            index: 2,
            title: "Screenshot · step:test-b:Tap Other",
            status: "ok",
            frames: [],
          },
        ],
        testStepEvidence: [
          {
            schemaVersion: 1,
            testStepId: "test-a",
            recipeId: "recipe",
            recipeStepId: "module-a",
            traceStepId: "module-a",
            traceStepIndex: 0,
            occurrence: 1,
            evidence: {
              framePaths: ["frames/a.png"],
              eventSequences: [],
              artifactKinds: ["screenshot"],
            },
          },
          {
            schemaVersion: 1,
            testStepId: "test-a",
            recipeId: "recipe",
            recipeStepId: "leaf-a",
            traceStepId: "leaf-a",
            traceStepIndex: 1,
            occurrence: 2,
            evidence: { framePaths: [], eventSequences: [], artifactKinds: [] },
          },
          {
            schemaVersion: 1,
            testStepId: "test-b",
            recipeId: "recipe",
            recipeStepId: "leaf-b",
            traceStepId: "leaf-b",
            traceStepIndex: 2,
            occurrence: 1,
            evidence: {
              framePaths: ["frames/b.png"],
              eventSequences: [],
              artifactKinds: ["screenshot"],
            },
          },
        ],
      },
      { channels: { screenshot: { entries: 2 } } },
    );
    expect(report.timeline.map((item) => item.framePaths)).toEqual([
      ["frames/a.png"],
      ["frames/b.png"],
    ]);
  });

  it("keeps the canonical outcome and human target while omitting empty evidence", () => {
    const report = projectRunReport(
      "run-1",
      {
        title: "Change the app language",
        outcome: "passed",
        deviceName: "Pixel 9",
        durationMs: 1_550,
        sourceRevision: { vcs: "git", sha: "abcdef1234567" },
        browserCaseProfile: { engine: "chromium", channel: "stable" },
        targetProfile: { id: "target-profile-1" },
        appVersion: "1.2.3",
        steps: [
          {
            index: 0,
            title: "Run saved Test",
            status: "ok",
            tone: "acc",
            actions: [{ kind: "re", at: 1 }],
          },
          {
            index: 1,
            title: "check identifier app:id/language visible",
            status: "ok",
            tone: "acc",
            actions: [{ kind: "ok", at: 2 }],
          },
        ],
        frames: [
          {
            path: "frames/language.png",
            caption: "Language settings",
            capturedAt: 1_700_000_000_000,
            mime: "image/png",
            base64: "iVBORw0KGgo=",
            width: 320,
            height: 640,
          },
        ],
        artifacts: [
          {
            kind: "app-map-test-execution-intent",
            data: { sourcePlan: { testId: "test-language" } },
          },
          { kind: "screenshot" },
        ],
      },
      {
        target: { id: "emulator-5554" },
        events: [{ sequence: 1, channel: "input", kind: "run.finished" }],
        channels: {
          screenshot: { entries: 2 },
          "ui-tree": { entries: 1 },
          network: { entries: 0 },
        },
        artifacts: [],
      },
    );
    expect(report.executionContext).toEqual({
      sourceRevision: "abcdef1234567",
      browser: "chromium",
      targetProfileId: "target-profile-1",
      appVersion: "1.2.3",
    });

    expect(report).toMatchObject({
      outcome: "passed",
      testId: "test-language",
      targetName: "Pixel 9",
      durationMs: 1_550,
      firstEvidence: {
        label: "Expected screen content was visible",
      },
    });
    expect(report.evidence.map((section) => section.id)).toEqual(["screenshot", "ui-tree"]);
    expect(report.evidence[0]).toMatchObject({
      detail: "2 screenshots",
      summary: "See the screens Relay captured while this Test ran.",
      inspectable: true,
      items: [
        {
          title: "Language settings",
          media: {
            kind: "image",
            src: "data:image/png;base64,iVBORw0KGgo=",
            width: 320,
            height: 640,
          },
        },
      ],
    });
    expect(report.timeline).toEqual([
      expect.objectContaining({
        title: "Expected screen content was visible",
        state: "passed",
      }),
    ]);
  });

  it("projects persisted TraceStep frames and log as observed legacy evidence", () => {
    const report = projectRunReport(
      "run-trace",
      {
        title: "Legacy trace",
        outcome: "passed",
        steps: [
          {
            id: "trace-1",
            index: 3,
            title: "Verify checkout",
            status: "ok",
            startedAt: 1_000,
            finishedAt: 2_500,
            log: "Checkout confirmation was visible",
            frames: [{ path: "frames/checkout.png" }],
          },
        ],
      },
      { channels: { screenshot: { entries: 1 } } },
    );
    expect(report.timeline[0]).toMatchObject({
      index: 3,
      framePaths: ["frames/checkout.png"],
      startedAt: 1_000,
      finishedAt: 2_500,
      log: "Checkout confirmation was visible",
      observed: "Checkout confirmation was visible",
    });
  });

  it("joins expectations only from the frozen recipe snapshot", () => {
    const report = projectRunReport(
      "run-recipe",
      {
        title: "Assert checkout",
        outcome: "passed",
        recipeSnapshot: {
          steps: [
            {
              id: "recipe-assert",
              kind: "assert-content",
              input: "screen",
              expected: "Order confirmed",
              match: "contains",
            },
          ],
        },
        steps: [
          {
            id: "trace-assert",
            recipeStepId: "recipe-assert",
            index: 0,
            title: "Verify checkout",
            status: "ok",
            log: "Order confirmed",
            frames: [],
          },
        ],
      },
      { channels: {} },
    );
    expect(report.timeline[0]).toMatchObject({
      expected: "Order confirmed",
      observed: "Order confirmed",
    });
  });

  it("does not join a recipe expectation when the trace step has no recipe identity", () => {
    const report = projectRunReport(
      "run-unjoined",
      {
        title: "Unjoined trace",
        recipeSnapshot: { steps: [{ kind: "assert-content", expected: "Do not infer" }] },
        steps: [{ index: 0, title: "Verify", status: "ok", frames: [] }],
      },
      { channels: {} },
    );
    expect(report.timeline[0]?.expected).toBeUndefined();
  });

  it("does not turn a harness failure into a product verdict", () => {
    const report = projectRunReport(
      "run-2",
      {
        outcome: "harness-failure",
        deviceName: "iPad Pro",
        failureCategory: "environment",
        error: "The device connection ended.",
        steps: [
          {
            index: 0,
            title: "Open Language",
            status: "error",
            tone: "fail",
            actions: [{ kind: "fail", at: 1 }],
          },
        ],
      },
      { channels: {} },
    );

    expect(report.outcome).toBe("harness-failure");
    expect(report.cause).toBe("The device connection ended.");
    expect(report.category).toBe("Setup");
    expect(report.firstEvidence?.label).toBe("Open Language");
    expect(report.evidence).toEqual([]);
    expect(report.timeline).toEqual([
      expect.objectContaining({ title: "Open Language", state: "failed" }),
    ]);
  });

  it("skips orchestration steps and leads with a meaningful passed checkpoint", () => {
    const report = projectRunReport(
      "run-meaningful",
      {
        outcome: "passed",
        steps: [
          {
            title: "Run saved Test",
            status: "ok",
            actions: [{ kind: "ok" }],
          },
          {
            title: "Open Language settings",
            status: "ok",
            actions: [{ kind: "ok" }],
          },
          {
            title: "check identifier language-menu visible",
            status: "ok",
            actions: [{ kind: "ok" }],
          },
        ],
      },
      { channels: {} },
    );

    expect(report.firstEvidence?.label).toBe("Expected screen content was visible");
    expect(report.firstEvidence?.label).not.toBe("Run saved Test");
  });

  it("uses a named captured screenshot when the only successful command is orchestration", () => {
    const report = projectRunReport(
      "run-captured-checkpoint",
      {
        outcome: "passed",
        steps: [
          {
            title: "Run saved Test",
            status: "ok",
            actions: [{ kind: "ok" }],
          },
          {
            title: "Screenshot · final:Arabic layout is readable",
            status: "ok",
            actions: [{ kind: "shot" }],
          },
        ],
      },
      { channels: {} },
    );

    expect(report.firstEvidence?.label).toBe("Arabic layout is readable");
  });

  it("never presents same-screen navigation as the primary verified assertion", () => {
    const report = projectRunReport(
      "run-tautology",
      {
        outcome: "passed",
        steps: [
          {
            title: "Screenshot · step:navigate:Go from Start to Start",
            status: "ok",
            actions: [{ kind: "ok" }],
          },
          {
            title: "Screenshot · step:checkpoint-1:Account settings remained visible",
            status: "ok",
            actions: [{ kind: "shot" }],
          },
        ],
      },
      { channels: {} },
    );

    expect(report.firstEvidence?.label).toBe("Account settings remained visible");
    expect(JSON.stringify(report)).not.toContain("Go from Start to Start");
  });

  it("maps recapture failures and machine target ids into public report copy", () => {
    const report = projectRunReport(
      "run-3",
      {
        outcome: "harness-failure",
        deviceName: "emulator-5554",
        error: "Start has no immutable raw accessibility tree; recapture before offline geometry.",
      },
      { channels: {} },
    );

    expect(report.targetName).toBeUndefined();
    expect(report.cause).toBe(
      "Relay needs a fresh capture of the starting screen before this Test can run.",
    );
    expect(JSON.stringify(report)).not.toContain("emulator-5554");
    expect(JSON.stringify(report)).not.toContain("raw accessibility");
  });

  it("prefers a resolved Test name over a machine-generated Run title", () => {
    const report = projectRunReport(
      "run-4",
      { title: "Run test-64f19d0e", outcome: "passed" },
      { channels: {} },
      undefined,
      false,
      "Change the app language",
    );

    expect(report.title).toBe("Change the app language");
    expect(JSON.stringify(report)).not.toContain("64f19d0e");
  });

  it("separates HTTP requests from device transport connections", () => {
    const report = projectRunReport(
      "run-network",
      { outcome: "passed" },
      {
        channels: {
          network: { entries: 48 },
        },
        network: [
          {
            id: "request-1",
            method: "GET",
            url: "https://example.com/account?token=hidden",
            status: 200,
            durationMs: 86,
            result: "success",
          },
        ],
        androidNetwork: {
          flows: [
            {
              protocol: "tls",
              host: "api.example.com",
              startedAtMs: 120,
              sentBytes: 512,
              receivedBytes: 2048,
              outcome: "connected",
            },
          ],
        },
      },
    );

    expect(report.evidence).toEqual([
      expect.objectContaining({
        id: "network",
        label: "Network activity",
        detail: "1 request · 1 connection",
        inspectable: true,
        items: [
          expect.objectContaining({
            title: "GET example.com/account",
            detail: "Status 200 · 86 ms",
          }),
          expect.objectContaining({
            title: "TLS · api.example.com",
            detail: "Connected · 512 B sent · 2.0 KB received",
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain("token=hidden");
    expect(JSON.stringify(report)).not.toContain("48 items");
  });
});
