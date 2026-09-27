import { describe, expect, it, vi } from "vitest";
import {
  admitLiveOpenPlan,
  compilePairedConfigurations,
  compilePlanAccountColumns,
  compilePlanProfileAccounts,
  compileRepeatScope,
  missingPlanAccountMessage,
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
        accountRevision: "7",
      },
      {
        id: "signed-out",
        name: "Signed out",
        browserId: "webkit-1",
        browserName: "WebKit",
        engine: "webkit",
        signedOutAttested: true,
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
    expect(compiled[0]?.coverage).toEqual({
      kind: "browser-account",
      accountId: "acct-admin",
      accountRevision: "3",
    });
    expect(compiled[2]?.coverage).toEqual({ kind: "signed-out", attested: true });

    const starts = compileTestStarts({
      testId: "checkout",
      appMapId: "app-1",
      workspace,
    });
    expect(starts).toEqual([
      {
        testId: "checkout",
        appMapId: "app-1",
        targetId: "chrome-1",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-admin", accountRevision: "3" },
      },
      {
        testId: "checkout",
        appMapId: "app-1",
        targetId: "firefox-1",
        engine: "firefox",
        account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      },
      {
        testId: "checkout",
        appMapId: "app-1",
        targetId: "webkit-1",
        engine: "webkit",
        account: { kind: "signed-out", attested: true },
      },
    ]);
    expect(starts).toHaveLength(3);
    expect(starts).not.toHaveLength(9);
    expect(starts[0]).not.toEqual(starts[1]);
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
            accountRevision: "4",
          },
          {
            id: "member",
            name: "Member",
            browserId: "chrome-1",
            browserName: "Chrome",
            engine: "chromium",
            accountId: "acct-member",
            accountRevision: "7",
          },
        ],
      }),
    );
    expect(compilePairedConfigurations(twoAccounts).map((item) => item.accountId)).toEqual([
      "acct-admin",
      "acct-member",
    ]);
    const starts = compileTestStarts({ testId: "checkout", workspace: twoAccounts });
    expect(starts).toHaveLength(2);
    expect(starts[0]?.targetId).toBe(starts[1]?.targetId);
    expect(starts[0]?.account).not.toEqual(starts[1]?.account);
    expect(starts[0]?.account).toEqual({
      kind: "fixture",
      accountId: "acct-admin",
      accountRevision: "4",
    });
    expect(starts[1]?.account).toEqual({
      kind: "fixture",
      accountId: "acct-member",
      accountRevision: "7",
    });
    expect(compileRepeatScope({ workspace: twoAccounts, dataCaseCount: 1 }).executionCount).toBe(2);
  });

  it("blocks an unattested blank account and an account without a revision", () => {
    const incomplete = parsePairedConfigurationWorkspace(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        rows: [
          {
            id: "blank",
            name: "Looks signed out",
            browserId: "chrome-1",
            browserName: "Chrome",
          },
          {
            id: "no-rev",
            name: "Admin",
            browserId: "chrome-1",
            browserName: "Chrome",
            accountId: "acct-admin",
          },
        ],
      }),
    );
    expect(compilePairedConfigurations(incomplete).map((item) => item.coverage.kind)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(() => compileTestStarts({ testId: "checkout", workspace: incomplete })).toThrow(
      /attested|revision/i,
    );
  });

  it("maps Suite targets in row order and Repeat scope as pairs times data cases", () => {
    expect(
      compileSuiteTargets(workspace, [
        { id: "env-ff", targetId: "firefox-1", accountId: "acct-member" },
        { id: "env-wk", targetId: "webkit-1" },
        { id: "env-ch-member", targetId: "chrome-1", accountId: "acct-member" },
        { id: "env-ch", targetId: "chrome-1", accountId: "acct-admin" },
      ]).profileIds,
    ).toEqual(["env-ch", "env-ff", "env-wk"]);
    expect(compileRepeatScope({ workspace, dataCaseCount: 1 })).toEqual({
      pairCount: 3,
      executionCount: 3,
      scopeLabel: "3 executions · 3 paired configurations",
    });
    expect(compileRepeatScope({ workspace, dataCaseCount: 2 }).executionCount).toBe(6);
    expect(
      compilePlanProfileAccounts(workspace, [
        { id: "env-ff", targetId: "firefox-1", accountId: "acct-member" },
        { id: "env-wk", targetId: "webkit-1" },
        { id: "env-ch-member", targetId: "chrome-1", accountId: "acct-member" },
        { id: "env-ch", targetId: "chrome-1", accountId: "acct-admin" },
      ]),
    ).toEqual([
      {
        profileId: "env-ch",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-admin", accountRevision: "3" },
      },
      {
        profileId: "env-ff",
        engine: "firefox",
        account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      },
      {
        profileId: "env-wk",
        engine: "webkit",
        account: { kind: "signed-out", attested: true },
      },
    ]);
  });

  it("does not shrink six requested accounts to the one bound column", () => {
    const six = parsePairedConfigurationWorkspace(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        rows: ["a", "b", "c", "d", "e", "f"].map((letter) => ({
          id: letter,
          name: `Account ${letter}`,
          browserId: "chrome-1",
          browserName: "Chrome",
          engine: "chromium",
          accountId: `acct-${letter}`,
          accountRevision: "1",
        })),
      }),
    );
    const columns = compilePlanAccountColumns(six, [
      {
        id: "env-ch",
        targetId: "chrome-1",
        authenticationOptions: [{ id: "acct-a", reference: "authfx:acct-a:1" }],
      },
    ]);
    expect(columns.requested).toBe(6);
    expect(columns.accounts).toHaveLength(1);
    expect(columns.unresolved).toHaveLength(5);
    expect(missingPlanAccountMessage(columns)).toMatch(/asked for 6 account columns/u);
    expect(missingPlanAccountMessage(columns)).toMatch(/not a 1-column pass/u);
  });

  it("keeps two accounts on one browser as two columns, not an unresolved pair", () => {
    const twoOnChrome = parsePairedConfigurationWorkspace(
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
            accountRevision: "3",
          },
          {
            id: "member",
            name: "Member",
            browserId: "chrome-1",
            browserName: "Chrome",
            engine: "chromium",
            accountId: "acct-member",
            accountRevision: "7",
          },
        ],
      }),
    );
    const environments = [
      {
        id: "env-ch",
        targetId: "chrome-1",
        authenticationOptions: [
          { id: "acct-admin", reference: "authfx:acct-admin:3" },
          { id: "acct-member", reference: "authfx:acct-member:7" },
        ],
      },
    ];
    expect(compileSuiteTargets(twoOnChrome, environments)).toEqual({
      profileIds: ["env-ch"],
      unresolved: [],
    });
    expect(compilePlanProfileAccounts(twoOnChrome, environments)).toEqual([
      {
        profileId: "env-ch",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-admin", accountRevision: "3" },
      },
      {
        profileId: "env-ch",
        engine: "chromium",
        account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      },
    ]);
  });

  it("opens the exact saved pairs in Live and restores identities after restart", () => {
    expect(liveOpenPlan(workspace)).toEqual([
      {
        name: "Admin desktop",
        browserId: "chrome-1",
        accountId: "acct-admin",
        accountName: "Admin",
        accountRevision: "3",
      },
      {
        name: "Member desktop",
        browserId: "firefox-1",
        accountId: "acct-member",
        accountName: "Member",
        accountRevision: "7",
      },
      { name: "Signed out", browserId: "webkit-1", signedOut: true },
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
      openSpace: vi.fn(async (plan) => {
        opened.push(
          `${plan.browserId}:${plan.accountId ?? (plan.signedOut ? "signed-out" : "missing")}`,
        );
      }),
    });
    expect(opened).toEqual(["chrome-1:acct-admin", "firefox-1:acct-member", "webkit-1:signed-out"]);
    expect(result.opened).toBe(3);
    expect(result.plan).toHaveLength(3);
  });

  it("refuses Admin, Member, and Signed out sharing one persistent Browser session", async () => {
    const sameBrowser = parsePairedConfigurationWorkspace(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1,
        rows: [
          {
            id: "admin",
            name: "Admin",
            browserId: "chrome-1",
            browserName: "Chrome",
            accountId: "acct-admin",
            accountRevision: "4",
            accountReference: "authfx:00000000-0000-4000-8000-0000000000aa:4",
          },
          {
            id: "member",
            name: "Member",
            browserId: "chrome-1",
            browserName: "Chrome",
            accountId: "acct-member",
            accountRevision: "7",
            accountReference: "authfx:00000000-0000-4000-8000-0000000000bb:7",
          },
          {
            id: "out",
            name: "Signed out",
            browserId: "chrome-1",
            browserName: "Chrome",
            signedOutAttested: true,
          },
        ],
      }),
    );
    const opened: string[] = [];
    expect(() => admitLiveOpenPlan(sameBrowser)).toThrow(/cannot share one persistent Browser/i);
    await expect(
      openPairedWorkspaceInLive({
        workspace: sameBrowser,
        openSpace: async (plan) => {
          opened.push(plan.browserId);
        },
      }),
    ).rejects.toThrow(/cannot share one persistent Browser/i);
    expect(opened).toEqual([]);
  });
});
