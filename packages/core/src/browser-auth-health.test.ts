import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  attachBrowserAuthenticationHealth,
  classifyBrowserAuthenticationHealth,
  planAccountHealthBlocker,
  planAccountStartBlocker,
  probeBrowserAuthenticationFixture,
  probeScheduledPlanAccountHealth,
  signedInFromPage,
} from "./browser-auth-health.js";
import { saveBrowserAuthenticationFixture } from "./browser-authentication-fixtures.js";

test("signed-in markers distinguish grok.com chrome from the login wall", () => {
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Ask Grok anything" }), true);
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Ask anything" }), true);
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Sign in\nContinue with Google" }), false);
  assert.equal(signedInFromPage({ title: "Grok", bodyText: "Settings" }), undefined);
  assert.equal(
    signedInFromPage({
      title: "Grok",
      bodyText:
        "What should we explore?\nImagine\nSign in\nSign up\nAsk Grok anything\nReject All\nEssential cookies keep the site working",
    }),
    false,
  );
});

test("expired and revoked fixtures fail closed before a live page probe", () => {
  const expired = classifyBrowserAuthenticationHealth(
    { name: "Member", expiresAt: 10 },
    20,
  );
  assert.equal(expired.status, "expired");
  assert.match(planAccountHealthBlocker(expired) ?? "", /Refresh/u);
  const revoked = classifyBrowserAuthenticationHealth({ name: "Member", revokedAt: 1 }, 20);
  assert.equal(revoked.status, "revoked");
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
    assert.equal(
      planAccountStartBlocker({
        account: { kind: "fixture", reference: saved.reference },
        fixtures: [
          {
            reference: saved.reference,
            health: { status: "error", checkedAt: 1, detail: "Chrome missing" },
          },
        ],
      }),
      undefined,
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
