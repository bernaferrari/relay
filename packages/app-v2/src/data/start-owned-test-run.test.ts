import { describe, expect, it } from "vitest";
import { emptyPairedWorkspace } from "./paired-configuration";
import { startOwnedTestRun, testStartRequests } from "./start-owned-test-run";
import { parsePairedConfigurationWorkspace } from "./paired-configuration";

const workspace = parsePairedConfigurationWorkspace(
  JSON.stringify({
    schemaVersion: 1,
    updatedAt: 1,
    rows: [
      { id: "a", name: "Admin desktop", browserId: "chrome-1", browserName: "Chrome" },
      { id: "b", name: "Member desktop", browserId: "firefox-1", browserName: "Firefox" },
      { id: "c", name: "Signed out", browserId: "webkit-1", browserName: "WebKit" },
    ],
  }),
);

describe("start owned Test runs", () => {
  it("uses the paired compiler instead of a single target when the workspace is selected", () => {
    expect(
      testStartRequests({
        usePairedWorkspace: true,
        workspace,
        testId: "checkout",
        appMapId: "app-1",
        targetId: "ignored-pixel",
      }).map((request) => request.targetId),
    ).toEqual(["chrome-1", "firefox-1", "webkit-1"]);
    expect(
      testStartRequests({
        workspace: emptyPairedWorkspace(),
        testId: "checkout",
        appMapId: "app-1",
        targetId: "pixel",
      }),
    ).toEqual([{ testId: "checkout", appMapId: "app-1", targetId: "pixel" }]);
  });

  it("starts every pair then inspects only the first Run", async () => {
    const started: string[] = [];
    const remembered: string[] = [];
    await startOwnedTestRun({
      requests: testStartRequests({
        usePairedWorkspace: true,
        workspace,
        testId: "checkout",
        appMapId: "app-1",
        targetId: "ignored",
      }),
      start: async (request) => {
        started.push(request.targetId ?? "");
        return {
          status: "queued",
          workflow: { workflowId: `wf-${request.targetId}` },
          run: { runId: `run-${request.targetId}` },
        } as never;
      },
      inspect: async (workflowId) =>
        ({
          status: "running",
          workflow: { workflowId },
          run: { runId: "run-chrome-1" },
        }) as never,
      remember: async (_state, workflowId, runId) => {
        remembered.push(`${workflowId}:${runId}`);
      },
    });
    expect(started).toEqual(["chrome-1", "firefox-1", "webkit-1"]);
    expect(remembered).toEqual(["wf-chrome-1:run-chrome-1"]);
  });
});
