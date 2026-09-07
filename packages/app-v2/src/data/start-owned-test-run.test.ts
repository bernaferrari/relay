import { describe, expect, it } from "vitest";
import { operationDefinition } from "@relay/protocol";
import { emptyPairedWorkspace } from "./paired-configuration";
import {
  profileTargetsFromStarts,
  startOwnedTestRun,
  startPairedTestBatch,
  testStartRequests,
  type CombineStartBody,
} from "./start-owned-test-run";
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
        engine: "chromium",
        accountId: "acct-admin",
        accountRevision: "4",
      },
      {
        id: "b",
        name: "Member desktop",
        browserId: "chrome-1",
        browserName: "Chrome",
        engine: "chromium",
        accountId: "acct-member",
        accountRevision: "7",
      },
      {
        id: "c",
        name: "Signed out",
        browserId: "webkit-1",
        browserName: "WebKit",
        engine: "webkit",
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
    expect(requests.map((request) => request.targetId)).toEqual([
      "chrome-1",
      "chrome-1",
      "webkit-1",
    ]);
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

  it("starts a single request through the ordinary Run path", async () => {
    const started: string[] = [];
    const result = await startOwnedTestRun({
      requests: [{ testId: "checkout", appMapId: "app-1", targetId: "pixel" }],
      start: async (request) => {
        started.push(request.targetId ?? "");
        return {
          status: "queued",
          workflow: { workflowId: "wf-pixel" },
          run: { runId: "run-pixel" },
        } as never;
      },
      inspect: async (workflowId) =>
        ({
          status: "running",
          workflow: { workflowId },
          run: { runId: "run-pixel" },
        }) as never,
      remember: async () => undefined,
    });
    expect(started).toEqual(["pixel"]);
    expect(result.children.map((child) => child.status)).toEqual(["started"]);
    expect(result.batchId).toBeUndefined();
  });

  it("refuses to loop start() for multiple pairs without one durable Batch", async () => {
    const started: string[] = [];
    await expect(
      startOwnedTestRun({
        requests: testStartRequests({
          usePairedWorkspace: true,
          workspace,
          testId: "checkout",
          appMapId: "app-1",
          targetId: "ignored",
        }),
        start: async (request) => {
          started.push(request.targetId ?? "");
          return { status: "queued" } as never;
        },
        inspect: async () => ({ status: "running" }) as never,
        remember: async () => undefined,
      }),
    ).rejects.toThrow(/durable Batch/i);
    expect(started).toEqual([]);
  });

  it("starts every compiled pair through one Combine campaign", async () => {
    const requests = testStartRequests({
      usePairedWorkspace: true,
      workspace,
      testId: "checkout",
      appMapId: "app-1",
      targetId: "ignored",
      profiles: [
        { id: "profile-admin", targetId: "chrome-1", account: { id: "acct-admin" } },
        { id: "profile-member", targetId: "chrome-1", account: { id: "acct-member" } },
        { id: "profile-out", targetId: "webkit-1" },
      ],
    });
    expect(requests.map((request) => request.targetProfileId)).toEqual([
      "profile-admin",
      "profile-member",
      "profile-out",
    ]);
    const started: string[] = [];
    const bodies: unknown[] = [];
    const result = await startOwnedTestRun({
      requests,
      start: async (request) => {
        started.push(request.targetId ?? "");
        return { status: "queued" } as never;
      },
      inspect: async () => {
        throw new Error("must not inspect children of a Batch");
      },
      remember: async () => undefined,
      startBatch: (batchRequests) =>
        startPairedTestBatch({
          requests: batchRequests,
          combineStart: async (body) => {
            bodies.push(body);
            return {
              campaign: {
                id: "batch-pairs",
                cases: [
                  {
                    cellId: "cell-admin",
                    status: "queued",
                    targetProfileId: "profile-admin",
                    targetId: "chrome-1",
                    engine: "chromium",
                    account: {
                      kind: "fixture",
                      accountId: "acct-admin",
                      accountRevision: "4",
                    },
                    runId: "run-admin",
                  },
                  {
                    cellId: "cell-member",
                    status: "blocked",
                    targetProfileId: "profile-member",
                    targetId: "chrome-1",
                    engine: "chromium",
                    account: {
                      kind: "fixture",
                      accountId: "acct-member",
                      accountRevision: "7",
                    },
                  },
                  {
                    cellId: "cell-out",
                    status: "pending",
                    targetProfileId: "profile-out",
                    targetId: "webkit-1",
                    engine: "webkit",
                    account: { kind: "signed-out", attested: true },
                  },
                ],
              },
            };
          },
        }),
    });
    expect(started).toEqual([]);
    expect(bodies).toEqual([
      {
        appMapId: "app-1",
        testId: "checkout",
        executionMode: "all",
        profileTargets: profileTargetsFromStarts(requests),
      },
    ]);
    expect(result.batchId).toBe("batch-pairs");
    expect(result.children.map((child) => child.status)).toEqual([
      "started",
      "blocked",
      "untouched",
    ]);
    expect(profileTargetsFromStarts(requests).map((item) => item.account)).toEqual([
      { kind: "fixture", accountId: "acct-admin", accountRevision: "4" },
      { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      { kind: "signed-out", attested: true },
    ]);
    expect(
      new Set(profileTargetsFromStarts(requests).map((item) => JSON.stringify(item.account))).size,
    ).toBe(3);
    expect(() => operationDefinition("job.combine.start").input.parse(bodies[0])).not.toThrow();
  });

  it("matches Batch children by account when cases keep runtime profile ids", async () => {
    const requests = testStartRequests({
      usePairedWorkspace: true,
      workspace,
      testId: "checkout",
      appMapId: "app-1",
      targetId: "ignored",
      profiles: [
        { id: "profile-admin", targetId: "chrome-1", account: { id: "acct-admin" } },
        { id: "profile-member", targetId: "chrome-1", account: { id: "acct-member" } },
        { id: "profile-out", targetId: "webkit-1" },
      ],
    });
    const result = await startPairedTestBatch({
      requests,
      combineStart: async (body) => {
        expect(() => operationDefinition("job.combine.start").input.parse(body)).not.toThrow();
        return {
          campaign: {
            id: "batch-runtime-profiles",
            cases: [
              {
                cellId: "cell-member",
                status: "blocked",
                targetProfileId: "pixel-en",
                targetId: "chrome-1",
                account: {
                  kind: "fixture",
                  accountId: "acct-member",
                  accountRevision: "7",
                },
                engine: "chromium",
              },
              {
                cellId: "cell-out",
                status: "pending",
                targetProfileId: "pixel-it",
                targetId: "webkit-1",
                account: { kind: "signed-out", attested: true },
                engine: "webkit",
              },
              {
                cellId: "cell-admin",
                status: "queued",
                targetProfileId: "pixel-en",
                targetId: "chrome-1",
                account: {
                  kind: "fixture",
                  accountId: "acct-admin",
                  accountRevision: "4",
                },
                engine: "chromium",
                runId: "run-admin",
              },
            ],
          },
        };
      },
    });
    expect(result.batchId).toBe("batch-runtime-profiles");
    expect(result.children.map((child) => child.status)).toEqual([
      "started",
      "blocked",
      "untouched",
    ]);
    expect(result.children[0]?.state?.run?.runId).toBe("run-admin");
  });

  it("does not treat a Batch with no scheduled cells as a successful expansion", async () => {
    const requests = testStartRequests({
      usePairedWorkspace: true,
      workspace,
      testId: "checkout",
      appMapId: "app-1",
      targetId: "ignored",
      profiles: [
        { id: "profile-admin", targetId: "chrome-1", account: { id: "acct-admin" } },
        { id: "profile-member", targetId: "chrome-1", account: { id: "acct-member" } },
        { id: "profile-out", targetId: "webkit-1" },
      ],
    });
    const result = await startPairedTestBatch({
      requests,
      combineStart: async () => ({ campaign: { id: "batch-empty", cases: [] } }),
    });
    expect(result.batchId).toBe("batch-empty");
    expect(result.recovery?.detail).toMatch(/without scheduled children/i);
    expect(result.children.map((child) => child.status)).toEqual([
      "untouched",
      "untouched",
      "untouched",
    ]);
  });

  it("carries the selected build and does not borrow a reordered child", async () => {
    const requests = testStartRequests({
      usePairedWorkspace: true,
      workspace,
      testId: "checkout",
      appMapId: "app-1",
      targetId: "ignored",
      sourceRevision: { vcs: "git", sha: "abcdef1" },
      profiles: [
        { id: "profile-admin", targetId: "chrome-1", account: { id: "acct-admin" } },
        { id: "profile-member", targetId: "chrome-1", account: { id: "acct-member" } },
        { id: "profile-out", targetId: "webkit-1" },
      ],
    }).slice(0, 2);
    const bodies: CombineStartBody[] = [];
    const result = await startPairedTestBatch({
      requests,
      combineStart: async (body) => {
        bodies.push(body);
        return {
          campaign: {
            id: "batch-reordered",
            cases: [
              {
                cellId: "other",
                status: "queued",
                targetId: "chrome-1",
                engine: "firefox",
                account: {
                  kind: "fixture",
                  accountId: "acct-admin",
                  accountRevision: "4",
                },
                runId: "run-wrong-engine",
              },
            ],
          },
        };
      },
    });
    expect(bodies[0]?.sourceRevision).toEqual({ vcs: "git", sha: "abcdef1" });
    expect(result.children.map((child) => child.status)).toEqual(["mismatched", "mismatched"]);
    expect(result.children[0]?.state?.run?.runId).toBeUndefined();
  });
});
