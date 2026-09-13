import assert from "node:assert/strict";
import test from "node:test";
import { GROK_WEB_APP_POLICY, identityPolicyForTarget } from "./app-identity-policy.js";
import { signedInFromPage } from "./browser-auth-health.js";
import type { SnapshotNode } from "./device.js";
import { conversationHistoryLabels } from "./screen-identity-history.js";
import { observeScreenIdentity } from "./screen-identity.js";

function accountSettingsNodes(): SnapshotNode[] {
  return [
    { role: "h1", label: "Account settings", visibleToUser: true },
    {
      role: "a",
      label: "Manage team permissions",
      rect: { x: 48, y: 160, width: 320, height: 36 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "a",
      label: "Change account password",
      rect: { x: 48, y: 208, width: 320, height: 36 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "textbox",
      label: "Current password",
      rect: { x: 400, y: 200, width: 360, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Delete account",
      rect: { x: 400, y: 800, width: 200, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
  ];
}

function billingTeamSettingsNodes(): SnapshotNode[] {
  return [
    { role: "h1", label: "Billing and seats", visibleToUser: true },
    {
      role: "a",
      label: "Manage team permissions",
      rect: { x: 40, y: 140, width: 280, height: 32 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Delete account",
      rect: { x: 40, y: 720, width: 180, height: 36 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "textbox",
      label: "Invoice email",
      rect: { x: 360, y: 180, width: 400, height: 36 },
      hittable: true,
      visibleToUser: true,
    },
  ];
}

function identityLabels(nodes: SnapshotNode[], policy?: typeof GROK_WEB_APP_POLICY): Set<string> {
  return new Set(
    observeScreenIdentity(nodes, policy ? { policy } : undefined).nodes.flatMap((node) =>
      node.label ? [node.label] : [],
    ),
  );
}

test("generic identity keeps permission and password controls as evidence", () => {
  const labels = identityLabels(accountSettingsNodes());
  assert.equal(labels.has("manage team permissions"), true);
  assert.equal(labels.has("change account password"), true);
  assert.equal(
    conversationHistoryLabels(accountSettingsNodes()).has("manage team permissions"),
    false,
  );
});

test("generic identity keeps a distant delete-account control when a form field is present", () => {
  const labels = identityLabels(accountSettingsNodes());
  assert.equal(labels.has("delete account"), true);
});

test("a second account-settings app keeps the same permission and deletion evidence", () => {
  const labels = identityLabels(billingTeamSettingsNodes());
  assert.equal(labels.has("manage team permissions"), true);
  assert.equal(labels.has("delete account"), true);
  assert.equal(labels.has("billing and seats"), true);
});

test("the grok pack still treats sidebar conversation titles as history", () => {
  const grokHome: SnapshotNode[] = [
    { role: "h1", label: "What should we explore?", visibleToUser: true },
    { role: "textbox", label: "Ask Grok anything", hittable: true, visibleToUser: true },
    { role: "a", label: "Paris capital of France", hittable: true, visibleToUser: true },
  ];
  assert.equal(
    conversationHistoryLabels(grokHome, GROK_WEB_APP_POLICY).has("paris capital of france"),
    true,
  );
  const labels = identityLabels(grokHome, GROK_WEB_APP_POLICY);
  assert.equal(labels.has("paris capital of france"), false);
  assert.equal(labels.has("what should we explore?"), true);
});

test("auth health uses the selected app pack, not a Test id containing account", () => {
  const accountPage = {
    title: "Account settings",
    bodyText: "Manage team permissions\nChange account password",
  };
  const grokSignedIn = { title: "Grok", bodyText: "Ask Grok anything" };
  assert.equal(signedInFromPage(accountPage), undefined);
  assert.equal(signedInFromPage(grokSignedIn), undefined);
  assert.equal(signedInFromPage(grokSignedIn, GROK_WEB_APP_POLICY), true);
  assert.equal(signedInFromPage(accountPage, GROK_WEB_APP_POLICY), undefined);
  assert.equal(identityPolicyForTarget({ appMapId: "test-account-internal" }), undefined);
  assert.equal(identityPolicyForTarget({ browserTargetId: "grok-com" })?.id, "grok-web");
  assert.equal(identityPolicyForTarget({ appMapId: "grok-web" })?.id, "grok-web");
});
