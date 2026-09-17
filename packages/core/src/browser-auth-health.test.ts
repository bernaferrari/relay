import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GROK_WEB_APP_POLICY } from "./app-identity-policy.js";
import {
  AccountNeedsReloginError,
  assertClaimedBrowserJobStartAllowed,
  attachBrowserAuthenticationHealth,
  claimedBrowserJobStartBlocker,
  claimedFixtureStartBlocker,
  classifyBrowserAuthenticationHealth,
  extractProbedAccountIdentity,
  planAccountHealthBlocker,
  planAccountStartBlocker,
  probeBrowserAuthenticationFixture,
  probeScheduledPlanAccountHealth,
  retryAuthenticationHealthStamp,
  signedInFromPage,
} from "./browser-auth-health.js";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";

test("signed-in markers distinguish grok.com chrome from the login wall", () => {
  const grok = GROK_WEB_APP_POLICY;
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Ask Grok anything" }, grok), true);
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Ask anything" }, grok), true);
  assert.equal(
    signedInFromPage({ title: "Grok", bodyText: "Sign in\nContinue with Google" }, grok),
    false,
  );
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Settings" }, grok), undefined);
  assert.equal(
    signedInFromPage(
      {
        title: "Grok",
        bodyText:
          "What should we explore?\nImagine\nSign in\nSign up\nAsk Grok anything\nReject All\nEssential cookies keep the site working",
      },
      grok,
    ),
    false,
  );
});

test("probe identity is the page account, not a Lane or SuperGrok stand-in", () => {
  const grok = GROK_WEB_APP_POLICY;
  assert.equal(
    extractProbedAccountIdentity({
      title: "Grok",
      bodyText: "Library\nPrivate Chat",
      labels: ["BF Bernardo Ferrari", "Profile picture, Bernardo Ferrari,  bferrari@ext.teachx.ai"],
    }),
    "Bernardo Ferrari",
  );
  assert.equal(
    extractProbedAccountIdentity({
      title: "Grok",
      bodyText: "Sign in\nImagine\nAsk Grok anything",
      labels: ["grok-lab", "SuperGrok", "grok-daily"],
    }),
    undefined,
  );
  const signedOut = classifyBrowserAuthenticationHealth(
    { name: "SuperGrok lab signed-in" },
    20,
    {
      title: "Grok",
      bodyText: "What should we explore?\nImagine\nSign in\nAsk Grok anything",
      labels: ["grok-lab"],
    },
    grok,
  );
  assert.equal(signedOut.status, "needs-relogin");
  assert.equal(signedOut.identity, undefined);
  assert.doesNotMatch(signedOut.detail ?? "", /SuperGrok|grok-lab/u);
  const signedIn = classifyBrowserAuthenticationHealth(
    { name: "SuperGrok lab signed-in" },
    20,
    {
      title: "Grok",
      bodyText: "Ask Grok anything\nNew Chat",
      labels: ["BF Bernardo Ferrari"],
    },
    grok,
  );
  assert.equal(signedIn.status, "ready");
  assert.equal(signedIn.identity, "Bernardo Ferrari");
  assert.match(signedIn.detail ?? "", /Signed in as Bernardo Ferrari/u);
  assert.doesNotMatch(signedIn.detail ?? "", /SuperGrok lab signed-in is signed in/u);
});

test("live leftover BF / Bernardo Ferrari chip is page identity, not SuperGrok", () => {
  const grok = GROK_WEB_APP_POLICY;
  const leftover = {
    title: "Grok",
    bodyText: "What should we explore?\nAsk Grok anything\nIntroducing Build Mode",
    labels: [
      "BF\nBernardo Ferrari",
      "BF",
      "Bernardo Ferrari",
      "Introducing Build Mode",
      "Dismiss",
      "Paris: France's Capital",
      "Best Local Coffee Shop Finder",
    ],
  };
  assert.equal(
    extractProbedAccountIdentity(leftover, "SuperGrok lab signed-in"),
    "Bernardo Ferrari",
  );
  assert.equal(
    extractProbedAccountIdentity({
      title: "Grok",
      bodyText: leftover.bodyText,
      labels: leftover.labels.filter((label) => label !== "BF\nBernardo Ferrari"),
    }),
    "Bernardo Ferrari",
  );
  assert.equal(
    extractProbedAccountIdentity({
      title: "Grok",
      bodyText: leftover.bodyText,
      labels: ["BF", "Paris: France's Capital", "Introducing Build Mode"],
    }),
    undefined,
  );
  const classified = classifyBrowserAuthenticationHealth(
    { name: "SuperGrok lab signed-in" },
    20,
    leftover,
    grok,
  );
  assert.equal(classified.status, "ready");
  assert.equal(classified.identity, "Bernardo Ferrari");
  assert.match(classified.detail ?? "", /Signed in as Bernardo Ferrari/u);
});

test("expired and revoked fixtures fail closed before a live page probe", () => {
  const expired = classifyBrowserAuthenticationHealth({ name: "Member", expiresAt: 10 }, 20);
  assert.equal(expired.status, "expired");
  assert.match(planAccountHealthBlocker(expired) ?? "", /Refresh/u);
  const revoked = classifyBrowserAuthenticationHealth({ name: "Member", revokedAt: 1 }, 20);
  assert.equal(revoked.status, "revoked");
  assert.match(planAccountHealthBlocker(revoked) ?? "", /revoked/u);
});

test("Plan start fails closed on error, revoked, and readyCount 0 fixture health", () => {
  assert.match(
    planAccountHealthBlocker({
      status: "error",
      checkedAt: 1,
      detail: "SuperGrok did not show a signed-in marker.",
    }) ?? "",
    /signed-in marker/u,
  );
  assert.match(
    planAccountHealthBlocker(
      { status: "ready", checkedAt: 1, signedIn: true, detail: "SuperGrok is signed in." },
      { readyCount: 0 },
    ) ?? "",
    /Refresh/u,
  );
  assert.equal(
    planAccountHealthBlocker({
      status: "ready",
      checkedAt: 1,
      signedIn: true,
      detail: "SuperGrok is signed in.",
    }),
    undefined,
  );
  assert.match(
    planAccountStartBlocker({
      account: {
        kind: "fixture",
        reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
      },
      fixtures: [
        {
          reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
          health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      ],
      readyCount: 0,
    }) ?? "",
    /lab probe failed/u,
  );
  assert.equal(
    planAccountStartBlocker({
      account: { kind: "signed-out" },
      fixtures: [
        {
          reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
          health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      ],
      readyCount: 0,
    }),
    undefined,
  );
  assert.equal(
    planAccountStartBlocker({
      fixtures: [
        {
          reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
          health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      ],
    }),
    undefined,
  );
  assert.match(
    planAccountStartBlocker({
      savedFixtureReference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
      fixtures: [
        {
          reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
          health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      ],
      readyCount: 0,
    }) ?? "",
    /lab probe failed/u,
  );
  assert.equal(
    planAccountStartBlocker({
      account: { kind: "fixture", accountId: "acct-a", accountRevision: "1" },
      fixtures: [],
      readyCount: 0,
    }),
    undefined,
  );
  for (const health of [
    { status: "expired" as const, checkedAt: 1, detail: "expired" },
    { status: "needs-relogin" as const, checkedAt: 1, signedIn: false, detail: "signed out" },
    { status: "revoked" as const, checkedAt: 1, detail: "revoked" },
    { status: "ready" as const, checkedAt: 1, signedIn: false, detail: "signed out" },
  ]) {
    assert.match(
      planAccountStartBlocker({
        savedFixtureReference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
        fixtures: [
          {
            reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
            health,
          },
        ],
      }) ?? "",
      /expired|signed out|revoked/u,
    );
  }
});

test("a signed-out live page is needs-relogin, not a product failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-auth-health-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "project-1",
      targetId: "grok-web",
      name: "Member",
      createdBy: "human:qa",
      storageState: { cookies: [], origins: [{ origin: "https://grok.com", localStorage: [] }] },
    });
    const probed = await probeBrowserAuthenticationFixture({
      projectId: "project-1",
      targetId: "grok-web",
      reference: saved.reference,
      inspectPage: async () => ({
        title: "Grok",
        bodyText:
          "What should we explore?\nImagine\nSign in\nSign up\nAsk Grok anything\nReject All",
      }),
    });
    assert.equal(probed.health.status, "needs-relogin");
    assert.equal(probed.health.signedIn, false);
    const attached = await attachBrowserAuthenticationHealth([saved]);
    assert.equal(attached[0]?.health.status, "needs-relogin");
    assert.match(
      planAccountStartBlocker({
        account: { kind: "fixture", reference: saved.reference },
        fixtures: [{ reference: saved.reference, health: probed.health }],
      }) ?? "",
      /Refresh/u,
    );
    assert.match(
      planAccountStartBlocker({
        account: { kind: "fixture", reference: saved.reference },
        fixtures: [
          {
            reference: saved.reference,
            health: { status: "error", checkedAt: 1, detail: "Chrome missing" },
          },
        ],
      }) ?? "",
      /Chrome missing/u,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a scheduled Plan probes grok.com cookies before the unattended start", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-schedule-auth-probe-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "default",
      targetId: "grok-com",
      name: "Member",
      createdBy: "human:qa",
      storageState: { cookies: [], origins: [{ origin: "https://grok.com", localStorage: [] }] },
    });
    const health = await probeScheduledPlanAccountHealth({
      projectId: "default",
      fallbackTargetId: "grok-com",
      profileTargets: [
        {
          account: {
            kind: "fixture",
            accountId: saved.id,
            accountRevision: String(saved.revision),
            reference: saved.reference,
          },
          target: { targetKind: "browser", browserTargetId: "grok-com" },
        },
        {
          account: { kind: "signed-out" },
          target: { targetKind: "browser", browserTargetId: "grok-com" },
        },
      ],
      inspectPage: async () => ({ title: "Grok", bodyText: "Sign in\nContinue with Google" }),
    });
    assert.equal(health.length, 1);
    assert.equal(health[0]?.status, "needs-relogin");
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a claimed signed-in fixture with remembered error health fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-claimed-fixture-start-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "mobile",
      targetId: "shop-web",
      name: "SuperGrok",
      createdBy: "human:qa",
      storageState: {
        cookies: [],
        origins: [{ origin: "https://example.test", localStorage: [] }],
      },
    });
    await mkdir(join(root, ".relay"), { recursive: true });
    await writeFile(
      join(root, ".relay", "browser-auth-health.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: {
          [saved.reference]: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      })}\n`,
    );
    assert.match(
      (await claimedFixtureStartBlocker({
        projectId: "mobile",
        targetId: "shop-web",
        account: {
          kind: "fixture",
          accountId: saved.id,
          accountRevision: String(saved.revision),
          reference: saved.reference,
        },
        savedFixtureReference: saved.reference,
      })) ?? "",
      /lab probe failed/u,
    );
    assert.match(
      (await claimedFixtureStartBlocker({
        projectId: "mobile",
        targetId: "shop-web",
        savedFixtureReference: saved.reference,
      })) ?? "",
      /lab probe failed/u,
    );
    assert.equal(
      await claimedFixtureStartBlocker({
        projectId: "mobile",
        targetId: "shop-web",
        account: { kind: "signed-out" },
        savedFixtureReference: saved.reference,
      }),
      undefined,
    );
    assert.equal(
      await claimedFixtureStartBlocker({
        projectId: "mobile",
        targetId: "shop-web",
      }),
      undefined,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("retry stamp uses remembered ready and will not drop parent blocked health to SuperGrok", () => {
  const blocked = {
    status: "error" as const,
    checkedAt: 1,
    detail: "lab probe failed",
  };
  const ready = {
    status: "ready" as const,
    checkedAt: 2,
    signedIn: true,
    detail: "SuperGrok is signed in.",
  };
  const refreshed = retryAuthenticationHealthStamp({ parent: blocked, remembered: ready });
  assert.equal(refreshed.blocker, undefined);
  assert.equal(refreshed.authenticationHealth?.status, "ready");
  const dropped = retryAuthenticationHealthStamp({ parent: blocked });
  assert.match(dropped.blocker ?? "", /lab probe failed/u);
  assert.equal(dropped.authenticationHealth, undefined);
  const staleReady = retryAuthenticationHealthStamp({
    parent: ready,
    remembered: blocked,
  });
  assert.match(staleReady.blocker ?? "", /lab probe failed/u);
  for (const status of ["expired", "needs-relogin", "revoked"] as const) {
    assert.match(
      retryAuthenticationHealthStamp({
        parent: { status, checkedAt: 1, detail: `${status} fixture` },
      }).blocker ?? "",
      new RegExp(status === "revoked" ? "revoked" : status, "u"),
    );
  }
  assert.match(
    retryAuthenticationHealthStamp({
      parent: { status: "ready", checkedAt: 1, signedIn: false, detail: "signed out" },
    }).blocker ?? "",
    /signed out/u,
  );
});

test("claimed browser job start blocks SuperGrok identity and leaves unsigned unbound", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-claimed-browser-job-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const saved = await saveBrowserAuthenticationFixture({
      projectId: "mobile",
      targetId: "shop-web",
      name: "SuperGrok",
      createdBy: "human:qa",
      storageState: {
        cookies: [],
        origins: [{ origin: "https://example.test", localStorage: [] }],
      },
    });
    await mkdir(join(root, ".relay"), { recursive: true });
    await writeFile(
      join(root, ".relay", "browser-auth-health.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        entries: {
          [saved.reference]: { status: "error", checkedAt: 1, detail: "lab probe failed" },
        },
      })}\n`,
    );
    const blocked = await claimedBrowserJobStartBlocker({
      projectId: "mobile",
      targetId: "shop-web",
      browserCaseProfile: { authenticationFixtureId: saved.reference },
      parentAuthenticationHealth: {
        status: "ready",
        checkedAt: 1,
        signedIn: true,
        detail: "stale SuperGrok",
      },
    });
    assert.match(blocked.blocker ?? "", /lab probe failed/u);
    const unsigned = await claimedBrowserJobStartBlocker({
      projectId: "mobile",
      targetId: "shop-web",
    });
    assert.equal(unsigned.blocker, undefined);
    assert.equal(unsigned.authenticationHealth, undefined);
    const stub = await claimedBrowserJobStartBlocker({
      projectId: "mobile",
      targetId: "shop-web",
      browserCaseProfile: { authenticationFixtureId: "member-session" },
    });
    assert.equal(stub.blocker, undefined);
    await assert.rejects(
      () =>
        assertClaimedBrowserJobStartAllowed({
          projectId: "mobile",
          targetId: "shop-web",
          browserCaseProfile: { authenticationFixtureId: saved.reference },
        }),
      (error: unknown) =>
        error instanceof AccountNeedsReloginError &&
        error.code === "ACCOUNT_NEEDS_RELOGIN" &&
        /lab probe failed/u.test(error.detail),
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Playwright grok-lab SuperGrok enqueue is not Electron persist:lane coverage", async () => {
  const playwright = await claimedBrowserJobStartBlocker({
    projectId: "default",
    targetId: "grok-com",
    laneId: "grok-lab",
    sessionStore: "playwright-user-data",
    electronGrokLabPartitionPresent: false,
  });
  assert.equal(playwright.blocker, undefined);

  const electron = await claimedBrowserJobStartBlocker({
    projectId: "default",
    targetId: "grok-com",
    laneId: "persist:lane:grok-lab",
    sessionStore: "electron-partition",
    electronGrokLabPartitionPresent: false,
  });
  assert.match(electron.blocker ?? "", /persist:lane:grok-lab is absent/u);

  const mixed = await claimedBrowserJobStartBlocker({
    projectId: "default",
    targetId: "grok-com",
    laneId: "persist:lane:grok-lab",
    sessionStore: "playwright-user-data",
    electronGrokLabPartitionPresent: false,
  });
  assert.match(mixed.blocker ?? "", /Playwright grok-lab SuperGrok is not Electron/u);
});
