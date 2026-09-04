import { describe, expect, it } from "vitest";
import { projectRunReport } from "./run-product-service";

describe("run report projection", () => {
  it("keeps the canonical outcome and human target while omitting empty evidence", () => {
    const report = projectRunReport(
      "run-1",
      {
        title: "Change the app language",
        outcome: "passed",
        deviceName: "Pixel 9",
        durationMs: 1_550,
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
      items: [{ title: "Language settings" }],
    });
    expect(report.timeline).toEqual([
      expect.objectContaining({
        title: "Expected screen content was visible",
        state: "passed",
      }),
    ]);
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
