import { render } from "solid-js/web";
import { beforeEach, expect, test, vi } from "vitest";
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
  builds: [
    {
      id: "web-production",
      platform: "web",
      artifactDigest: digest,
      sourceSha: headSha,
      configuration: "production",
      environmentRevision: "fixture-v1",
    },
  ],
  selection: {
    affectedJourneys: [
      {
        appMapId: "settings",
        testId: "settings-language",
        reason: "The changed localization resource is bound to this Test.",
        confidence: "definite",
      },
    ],
    targetCases: [
      {
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
      },
    ],
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

beforeEach(() => {
  mocks.runAction.mockReset();
});

function enterValue(root: HTMLElement, id: string, value: string): void {
  const element = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!element) throw new Error(`missing #${id}`);
  element.value = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

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

test("starts one exact awaiting-build Proof and rejects invalid provenance locally", async () => {
  const createdProof = {
    ...proof,
    id: "proof-new",
    version: 1,
    state: "awaiting-build",
    decision: undefined,
    change: {
      repository: "acme/settings",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      pullRequest: 184,
      agentClaim: {
        summary: "Add Arabic Settings support",
        acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
      },
    },
    builds: [],
    selection: { affectedJourneys: [], targetCases: [] },
    planApproval: undefined,
    runIds: [],
    evidenceDigests: [],
    firstCausalFailure: undefined,
    coverageGaps: ["Exact builds and affected journeys are not attached yet."],
    residualRisk: [],
    smallestNextVerification: {
      kind: "provide-build",
      reason: "Bind an exact build for the head commit.",
    },
    lastMutation: {
      ...proof.lastMutation,
      action: "start",
      proofId: "proof-new",
      previousVersion: 0,
      version: 1,
    },
  } as unknown as ChangeVerification;
  let created = false;
  let finishStart!: () => void;
  const startBarrier = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: created ? [createdProof] : [] };
    if (operationId === "proof.start") {
      await startBarrier;
      created = true;
      return { proof: createdProof, receipt: createdProof.lastMutation, disposition: "created" };
    }
    if (operationId === "proof.inspect") return { proof: createdProof, history: [createdProof] };
    throw new Error(`unexpected ${operationId}`);
  });

  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() => expect(root.textContent).toContain("No Proofs yet"));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Start a Proof")
    ?.click();
  expect(root.textContent).toContain("Bind the exact change");

  enterValue(root, "proof-repository", "acme/settings");
  enterValue(root, "proof-baseSha", "not-a-sha");
  enterValue(root, "proof-headSha", "b".repeat(40));
  root
    .querySelector<HTMLFormElement>('form[aria-label="Start a Proof"]')!
    .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  expect(root.textContent).toContain("Enter the exact 40-character base commit SHA.");
  expect(mocks.runAction).not.toHaveBeenCalledWith("proof.start", expect.anything());

  enterValue(root, "proof-baseSha", "A".repeat(40));
  enterValue(root, "proof-pullRequest", "184");
  enterValue(root, "proof-summary", "Add Arabic Settings support");
  enterValue(root, "proof-acceptanceCriteria", "Settings render in Arabic without RTL overlap");
  const form = root.querySelector<HTMLFormElement>('form[aria-label="Start a Proof"]')!;
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(mocks.runAction).toHaveBeenCalledWith("proof.start", {
      change: {
        repository: "acme/settings",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        pullRequest: 184,
        agentClaim: {
          summary: "Add Arabic Settings support",
          acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
        },
      },
      policy: { id: "relay.verify-change", version: 1 },
    }),
  );
  expect(
    mocks.runAction.mock.calls.filter(([operationId]) => operationId === "proof.start"),
  ).toHaveLength(1);
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Starting…",
    )?.disabled,
  ).toBe(true);

  finishStart();
  await vi.waitFor(() => expect(root.textContent).toContain("Awaiting build"));
  expect(root.textContent).toContain("Bind an exact build for the head commit.");

  dispose();
  root.remove();
});
