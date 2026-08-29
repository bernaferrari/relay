import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { ChangeVerification } from "@relay/protocol";

const mocks = vi.hoisted(() => ({ runAction: vi.fn() }));
vi.mock("../context/server", () => ({ useServer: () => ({ runAction: mocks.runAction }) }));

import { ChangesWorkspace } from "./changes-workspace";

const digest = `sha256:${"a".repeat(64)}` as const;
const headSha = "2".repeat(40);
const proof = {
  schemaVersion: 2,
  id: "proof-184",
  organizationId: "acme",
  projectId: "relay",
  version: 4,
  state: "rejected",
  decision: "rejected",
  change: {
    repository: "acme/settings",
    baseSha: "1".repeat(40),
    headSha,
    pullRequest: 184,
    agentClaim: {
      summary: "Add Arabic Settings support",
      acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
    },
  },
  builds: [{
    id: "web-production",
    platform: "web",
    artifactDigest: digest,
    sourceSha: headSha,
    configuration: "production",
    environmentRevision: "fixture-v1",
  }],
  selection: {
    affectedJourneys: [{
      appMapId: "settings",
      testId: "settings-language",
      reason: "The changed localization resource is bound to this Test.",
      confidence: "definite",
    }],
    targetCases: [{
      id: "chromium-compact-ar",
      executionTarget: {
        schemaVersion: 1,
        kind: "local-browser",
        provider: { key: "relay.local.browser", scope: "local" },
        targetId: "web",
        platform: "browser",
        identity: { kind: "browser-target", value: "web" },
      },
      targetProfile: {
        id: "web:compact:ar",
        targetId: "web",
        source: "browser",
        platform: "browser",
        name: "Compact Chromium Arabic",
        viewport: { width: 390, height: 844 },
        browserCaseProfile: {
          schemaVersion: 1,
          engine: "chromium",
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          mobile: true,
          touch: true,
          locale: "ar",
          timezoneId: "UTC",
          colorScheme: "dark",
          reducedMotion: "no-preference",
          permissions: [],
          offline: false,
          environmentRevision: "fixture-v1",
        },
        capabilities: ["snapshot", "screenshot", "tap"],
        observedAt: 100,
      },
      dimensions: { locale: "ar" },
      required: true,
    }],
  },
  planApproval: {
    decisionId: "decision-1",
    approvedBy: "human:reviewer",
    approvedAt: 200,
    reason: "Reviewed exact plan.",
  },
  policy: { id: "relay.default", version: 3 },
  runIds: ["run-rtl-failed"],
  evidenceDigests: [digest],
  firstCausalFailure: {
    runId: "run-rtl-failed",
    testId: "settings-language",
    targetCaseId: "chromium-compact-ar",
    checkId: "rtl-overlap",
    summary: "Primary action overlaps the Arabic description by 22 px.",
    evidenceRefs: [digest],
  },
  coverageGaps: [],
  residualRisk: ["Physical iOS is advisory for this repository."],
  smallestNextVerification: {
    kind: "review",
    reason: "Repair the first causal regression, then create a new Proof for the new head.",
  },
  requestedBy: "agent:coder",
  updatedBy: "system:relay",
  lastMutation: {
    schemaVersion: 1,
    requestId: "decision",
    requestDigest: digest,
    action: "record-decision",
    actorId: "system:relay",
    proofId: "proof-184",
    previousVersion: 3,
    version: 4,
    at: 400,
  },
  createdAt: 100,
  updatedAt: 400,
} satisfies ChangeVerification;

test("presents one Change-first Proof without internal orchestration vocabulary", async () => {
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: [proof] };
    if (operationId === "proof.inspect") return { proof, history: [proof] };
    throw new Error(`unexpected ${operationId}`);
  });
  const onOpenRun = vi.fn();
  const onOpenMap = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => <ChangesWorkspace onOpenRun={onOpenRun} onOpenMap={onOpenMap} />,
    root,
  );

  await vi.waitFor(() => expect(root.textContent).toContain("Add Arabic Settings support"));
  expect(root.textContent).toContain("Prove a change");
  expect(root.textContent).toContain("Rejected");
  expect(root.textContent).toContain("The changed localization resource is bound to this Test.");
  expect(root.textContent).toContain("chromium · 390 × 844 · ar");
  expect(root.textContent).toContain("Primary action overlaps the Arabic description by 22 px.");
  expect(root.textContent).toContain("Physical iOS is advisory for this repository.");
  expect(root.textContent).toContain(
    "Repair the first causal regression, then create a new Proof for the new head.",
  );
  expect(root.textContent).not.toMatch(/campaign|lease|raw operation/i);

  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Open run-rtl-failed"))
    ?.click();
  expect(onOpenRun).toHaveBeenCalledWith("run-rtl-failed");
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("settings-language"))
    ?.click();
  expect(onOpenMap).toHaveBeenCalledWith("settings");
  dispose();
  root.remove();
});
