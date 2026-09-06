import { describe, expect, it } from "vitest";
import { emptyPairedWorkspace } from "./paired-configuration";
import { startOwnedTestRun, testStartRequests } from "./start-owned-test-run";
import { parsePairedConfigurationWorkspace } from "./paired-configuration";

const workspace = parsePairedConfigurationWorkspace(
  JSON.stringify({
    schemaVersion: 1,
    updatedAt: 1,
    rows: [
      {
        id: "a",
        name: "Admin desktop",
        browserId: "chrome-1",
        browserName: "Chrome",
        accountId: "acct-admin",
        accountRevision: "4",
      },
      {
        id: "b",
        name: "Member desktop",
        browserId: "chrome-1",
        browserName: "Chrome",
        accountId: "acct-member",
        accountRevision: "7",
      },
      {
        id: "c",
        name: "Signed out",
        browserId: "webkit-1",
        browserName: "WebKit",
        signedOutAttested: true,
      },
    ],
  }),
);

describe("start owned Test runs", () => {
  it("uses the paired compiler instead of a single target when the workspace is selected", () => {
    const requests = testStartRequests({
      usePairedWorkspace: true,
      workspace,
      testId: "checkout",
      appMapId: "app-1",
      targetId: "ignored-pixel",
    });
    expect(requests.map((request) => request.targetId)).toEqual(["chrome-1", "chrome-1", "webkit-1"]);
    expect(requests.map((request) => request.account)).toEqual([
      { kind: "fixture", accountId: "acct-admin", accountRevision: "4" },
      { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      { kind: "signed-out", attested: true },
    ]);
    expect(requests[0]).not.toEqual(requests[1]);
    expect(
      testStartRequests({
        workspace: emptyPairedWorkspace(),
        testId: "checkout",
        appMapId: "app-1",
        targetId: "pixel",
      }),
    ).toEqual([{ testId: "checkout", appMapId: "app-1", targetId: "pixel" }]);
  });

  it("does not expand later pairs when the first start is recovering", async () => {
    const started: string[] = [];
    const remembered: string[] = [];
    const result = await startOwnedTestRun({
      requests: testStartRequests({
        usePairedWorkspace: true,
        workspace,
        testId: "checkout",
        appMapId: "app-1",
        targetId: "ignored",
      }),
      start: async (request) => {
        started.push(`${request.targetId}:${request.account?.kind ?? "none"}`);
        return {
          status: "idle",
          recovery: { code: "transport", title: "Wait", detail: "Need review", recovery: "Retry" },
        } as never;
      },
      inspect: async () => {
        throw new Error("must not inspect a recovering first start");
      },
      remember: async (_state, workflowId, runId) => {
        remembered.push(`${workflowId}:${runId}`);
      },
    });
    expect(started).toEqual(["chrome-1:fixture"]);
    expect(remembered).toEqual([]);
    expect(result.children.map((child) => child.status)).toEqual([
      "blocked",
      "untouched",
      "untouched",
    ]);
  });

  it("remembers every started child and leaves later failures untouched", async () => {
    const started: string[] = [];
    const remembered: string[] = [];
    const result = await startOwnedTestRun({
      requests: testStartRequests({
        usePairedWorkspace: true,
        workspace,
        testId: "checkout",
        appMapId: "app-1",
        targetId: "ignored",
      }),
      start: async (request) => {
        const identity =
          request.account && request.account.kind === "fixture"
            ? request.account.accountId
            : "signed-out";
        started.push(identity);
        if (identity === "acct-member") {
          return {
            status: "idle",
            recovery: { code: "transport", title: "Wait", detail: "Need review", recovery: "Retry" },
          } as never;
        }
        return {
          status: "queued",
          workflow: { workflowId: `wf-${identity}` },
          run: { runId: `run-${identity}` },
        } as never;
      },
      inspect: async (workflowId) =>
        ({
          status: "running",
          workflow: { workflowId },
          run: { runId: workflowId.replace("wf-", "run-") },
        }) as never,
      remember: async (_state, workflowId, runId) => {
        remembered.push(`${workflowId}:${runId}`);
      },
    });
    expect(started).toEqual(["acct-admin", "acct-member", "signed-out"]);
    expect(remembered).toEqual(["wf-acct-admin:run-acct-admin", "wf-signed-out:run-signed-out"]);
    expect(result.children.map((child) => child.status)).toEqual([
      "started",
      "blocked",
      "started",
    ]);
  });
});
