import assert from "node:assert/strict";
import test from "node:test";
import { GROK_WEB_APP_POLICY } from "./app-identity-policy.js";
import { evaluateApprovalPolicy } from "./approval-policy.js";
import type { ApprovalPolicyInput } from "@relay/protocol";
import { classifyBrowserAuthenticationHealth, signedInFromPage } from "./browser-auth-health.js";
import { contentAssertionPassed } from "./content-assertion-match.js";
import { extractNewestCompletedAssistantTurn } from "./recipe-extract.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { isTargetUnavailableError } from "./target-unavailable.js";

const UNCHANGED_NUMBER_CHECK = { expected: "4", match: "number-equals" as const };

test("seeded wrong response stays a check failure until the same number-equals check is repaired", () => {
  assert.equal(
    contentAssertionPassed("5", UNCHANGED_NUMBER_CHECK.expected, UNCHANGED_NUMBER_CHECK.match),
    false,
  );
  assert.equal(
    contentAssertionPassed("4", UNCHANGED_NUMBER_CHECK.expected, UNCHANGED_NUMBER_CHECK.match),
    true,
  );
});

test("seeded missing permission control stays failed until the same control is present", () => {
  const broken = observeScreenIdentity([
    { role: "h1", label: "Account settings", visibleToUser: true },
    { role: "textbox", label: "Current password", visibleToUser: true },
  ]);
  const repaired = observeScreenIdentity([
    { role: "h1", label: "Account settings", visibleToUser: true },
    { role: "a", label: "Manage team permissions", visibleToUser: true },
    { role: "textbox", label: "Current password", visibleToUser: true },
  ]);
  const hasPermission = (observation: ReturnType<typeof observeScreenIdentity>) =>
    observation.nodes.some((node) => node.label === "manage team permissions");
  assert.equal(hasPermission(broken), false);
  assert.equal(hasPermission(repaired), true);
});

test("seeded wrong account stays needs-relogin until the selected app pack sees signed-in chrome", () => {
  const signedOut = { title: "Grok", bodyText: "Sign in\nContinue with Google" };
  const signedIn = { title: "Grok", bodyText: "Ask Grok anything\nNew chat" };
  assert.equal(signedInFromPage(signedOut, GROK_WEB_APP_POLICY), false);
  assert.equal(signedInFromPage(signedIn, GROK_WEB_APP_POLICY), true);
});

test("seeded expired fixture stays expired until the same health check sees a live expiry", () => {
  const expired = classifyBrowserAuthenticationHealth({ name: "Member", expiresAt: 10 }, 20);
  const live = classifyBrowserAuthenticationHealth({ name: "Member", expiresAt: 30 }, 20);
  assert.equal(expired.status, "expired");
  assert.equal(live.status, "ready");
});

test("seeded unavailable device stays could-not-run until the device is connected", () => {
  assert.equal(
    isTargetUnavailableError(new Error("device missing: pixel-9 is no longer connected")),
    true,
  );
  assert.equal(isTargetUnavailableError(new Error("Manage team permissions was not found")), false);
});

test("seeded missing evidence never becomes a pass", () => {
  const incomplete: ApprovalPolicyInput = {
    schemaVersion: 1,
    policy: { id: "protected-release", version: 3 },
    executionRisk: {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: ["com.example.app"],
      cleanupRequired: false,
    },
    confirmationSatisfied: false,
    evidence: {
      status: "partial",
      requiredChannels: ["input", "screenshot"],
      missing: ["screenshot"],
    },
    verification: {
      requiredPaths: "passed",
      selectorResolution: "deterministic",
      unresolved: [],
    },
    findings: [],
  };
  const complete = {
    ...incomplete,
    evidence: {
      status: "complete" as const,
      requiredChannels: ["input", "screenshot"],
      missing: [],
      tracePackDigest: `sha256:${"a".repeat(64)}`,
    },
  };
  assert.notEqual(evaluateApprovalPolicy(incomplete).decision, "approve");
  assert.equal(evaluateApprovalPolicy(complete).decision, "approve");
});

test("seeded legitimate dynamic text still fails an unchanged number-equals check on the newest turn", () => {
  const page = [
    {
      role: "article",
      label: "Grok",
      identifier: "assistant-message",
      value: "5",
      rect: { x: 200, y: 420, width: 400, height: 48 },
      visibleToUser: true,
    },
  ];
  const extracted = extractNewestCompletedAssistantTurn(page, { identifier: "assistant-message" });
  assert.equal(
    contentAssertionPassed(
      extracted,
      UNCHANGED_NUMBER_CHECK.expected,
      UNCHANGED_NUMBER_CHECK.match,
    ),
    false,
  );
  assert.equal(
    contentAssertionPassed("4", UNCHANGED_NUMBER_CHECK.expected, UNCHANGED_NUMBER_CHECK.match),
    true,
  );
});
