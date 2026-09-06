import { describe, expect, it, vi } from "vitest";
import {
  compilePairedConfigurations,
  compileRepeatScope,
  compileSuiteTargets,
  compileTestStarts,
  liveOpenPlan,
  openPairedWorkspaceInLive,
  parsePairedConfigurationWorkspace,
} from "./paired-configuration";

const workspace = parsePairedConfigurationWorkspace(
  JSON.stringify({
    schemaVersion: 1,
    updatedAt: 1,
    rows: [
      {
        id: "admin",
        name: "Admin desktop",
        browserId: "chrome-1",
        browserName: "Chrome",
        engine: "chromium",
        accountId: "acct-admin",
        accountName: "Admin",
        accountRevision: "3",
      },
      {
        id: "member",
        name: "Member desktop",
        browserId: "firefox-1",
        browserName: "Firefox",
        engine: "firefox",
        accountId: "acct-member",
        accountName: "Member",
      },
      {
        id: "signed-out",
        name: "Signed out",
        browserId: "webkit-1",
        browserName: "WebKit",
        engine: "webkit",
      },
    ],
  }),
);

describe("paired Browser and Account workspace", () => {
  it("compiles three named pairs into three executions, never a cross-product", () => {
    const compiled = compilePairedConfigurations(workspace);
    expect(compiled.map((item) => item.targetId)).toEqual(["chrome-1", "firefox-1", "webkit-1"]);
    expect(compiled.map((item) => item.accountId)).toEqual([
      "acct-admin",
      "acct-member",
      undefined,
    ]);
    expect(compiled).toHaveLength(3);
    expect(compiled[0]?.coverage).toEqual({ kind: "browser-account", accountId: "acct-admin" });
    expect(compiled[2]?.coverage).toEqual({ kind: "browser-engine", engine: "webkit" });

    const starts = compileTestStarts({
      testId: "checkout",
      appMapId: "app-1",
      workspace,
    });
    expect(starts).toEqual([
      { testId: "checkout", appMapId: "app-1", targetId: "chrome-1" },
      { testId: "checkout", appMapId: "app-1", targetId: "firefox-1" },
      { testId: "checkout", appMapId: "app-1", targetId: "webkit-1" },
    ]);
    expect(starts).toHaveLength(3);
    expect(starts).not.toHaveLength(9);
  });

  it("starts every compiled pair through the same Test start compiler", async () => {
    const started: string[] = [];
    const { startPairedTestRuns } = await import("./paired-configuration");
    await startPairedTestRuns({
      testId: "checkout",
      workspace,
      start: async (request) => {
        started.push(request.targetId ?? "");
        return { status: "queued" };
      },
    });
    expect(started).toEqual(["chrome-1", "firefox-1", "webkit-1"]);
  });

  it("keeps two accounts on one Chromium browser as two executions, not one", () => {
    const twoAccounts = parsePairedConfigurationWorkspace(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        rows: [
          {
            id: "admin",
            name: "Admin",
            browserId: "chrome-1",
            browserName: "Chrome",
            engine: "chromium",
            accountId: "acct-admin",
          },
          {
            id: "member",
            name: "Member",
            browserId: "chrome-1",
            browserName: "Chrome",
            engine: "chromium",
            accountId: "acct-member",
          },
        ],
      }),
    );
    expect(compilePairedConfigurations(twoAccounts).map((item) => item.accountId)).toEqual([
      "acct-admin",
      "acct-member",
    ]);
    expect(compileRepeatScope({ workspace: twoAccounts, dataCaseCount: 1 }).executionCount).toBe(2);
  });

  it("maps Suite targets in row order and Repeat scope as pairs times data cases", () => {
    expect(
      compileSuiteTargets(workspace, [
        { id: "env-ff", targetId: "firefox-1" },
        { id: "env-wk", targetId: "webkit-1" },
        { id: "env-ch", targetId: "chrome-1" },
      ]).profileIds,
    ).toEqual(["env-ch", "env-ff", "env-wk"]);
    expect(compileRepeatScope({ workspace, dataCaseCount: 1 })).toEqual({
      pairCount: 3,
      executionCount: 3,
      scopeLabel: "3 executions · 3 paired configurations",
    });
    expect(compileRepeatScope({ workspace, dataCaseCount: 2 }).executionCount).toBe(6);
  });

  it("opens the exact saved pairs in Live and restores identities after restart", () => {
    expect(liveOpenPlan(workspace)).toEqual([
      {
        name: "Admin desktop",
        browserId: "chrome-1",
        accountId: "acct-admin",
        accountName: "Admin",
      },
      {
        name: "Member desktop",
        browserId: "firefox-1",
        accountId: "acct-member",
        accountName: "Member",
      },
      { name: "Signed out", browserId: "webkit-1" },
    ]);
    const restored = parsePairedConfigurationWorkspace(JSON.stringify(workspace));
    expect(restored.rows.map((row) => row.name)).toEqual([
      "Admin desktop",
      "Member desktop",
      "Signed out",
    ]);
  });

  it("opens each saved pair through the Live open path", async () => {
    const opened: string[] = [];
    const result = await openPairedWorkspaceInLive({
      workspace,
      openSpace: vi.fn(async (browserId) => {
        opened.push(browserId);
      }),
    });
    expect(opened).toEqual(["chrome-1", "firefox-1", "webkit-1"]);
    expect(result.opened).toBe(3);
    expect(result.plan).toHaveLength(3);
  });
});
