import { render } from "solid-js/web";
import { beforeEach, expect, test, vi } from "vitest";
import type { ChangeVerification } from "@relay/protocol";

const mocks = vi.hoisted(() => ({
  runAction: vi.fn(),
  health: vi.fn(() => "online"),
  sseConnected: vi.fn(() => true),
  proofListeners: new Map<string, Set<(notice: unknown) => void>>(),
  watchProofExecution: vi.fn((proofId: string, listener: (notice: unknown) => void) => {
    let listeners = mocks.proofListeners.get(proofId);
    if (!listeners) {
      listeners = new Set();
      mocks.proofListeners.set(proofId, listeners);
    }
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }),
}));
vi.mock("../context/server", () => ({
  useServer: () => ({
    runAction: mocks.runAction,
    health: mocks.health,
    sseConnected: mocks.sseConnected,
    watchProofExecution: mocks.watchProofExecution,
  }),
}));

import { ChangesWorkspace } from "./changes-workspace";
import { ConfirmDialogHost } from "./confirm-dialog";

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
        appMapRevision: 3,
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
    cells: [
      {
        id: "cell-ar-pilot",
        journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 3 },
        targetCaseId: "chromium-compact-ar",
        buildId: "web-production",
        requirement: "required",
        selectionReason: "The changed localization resource is bound to this Test.",
        dimensions: { locale: "ar" },
        routeVariantDigest: digest,
        evidencePolicyDigest: digest,
        executionRiskDigest: digest,
        estimatedDurationMs: 45_000,
        cleanupRequired: true,
      },
      {
        id: "cell-ar-advisory",
        journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 3 },
        targetCaseId: "chromium-compact-ar",
        buildId: "web-production",
        requirement: "advisory",
        selectionReason: "Visual evidence adds useful confidence without blocking merge.",
        dimensions: { locale: "ar", lens: "visual" },
        routeVariantDigest: digest,
        evidencePolicyDigest: digest,
        executionRiskDigest: digest,
        estimatedDurationMs: 75_000,
        cleanupRequired: true,
      },
    ],
    pilotCellId: "cell-ar-pilot",
  },
  planApproval: {
    decisionId: "decision-1",
    approvedBy: "human:reviewer",
    approvedAt: 200,
    reason: "Reviewed exact plan.",
  },
  policy: { id: "relay.default", version: 3 },
  policyDigest: digest,
  planDigest: digest,
  decisionDigest: digest,
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

const publication = {
  schemaVersion: 1,
  sequence: 1,
  organizationId: "acme",
  projectId: "relay",
  proofId: proof.id,
  provider: "github",
  repository: proof.change.repository,
  headSha,
  externalId: proof.id,
  checkRunId: 42,
  checkDigest: digest,
  conclusion: "failure",
  htmlUrl: "https://github.com/acme/settings/runs/42",
  publishedAt: 500,
} as const;

const exhaustedPublication = {
  schemaVersion: 1,
  id: "publication-proof-184-v4",
  organizationId: "acme",
  projectId: "relay",
  proofId: proof.id,
  proofVersion: proof.version,
  provider: "github",
  repository: proof.change.repository,
  headSha,
  externalId: proof.id,
  check: {
    schemaVersion: 1,
    name: "Relay Proof",
    externalId: proof.id,
    headSha,
    status: "completed",
    conclusion: "failure",
    classification: "rejected",
    title: "Relay Proof — REJECTED",
    summary: "A required verification case failed.",
    text: "Inspect Relay for exact evidence.",
  },
  createdAt: 450,
  status: "retry",
  attempts: 5,
  maxAttempts: 5,
  lastFailure: { kind: "provider-error", at: 500 },
  updatedAt: 500,
} as const;

beforeEach(() => {
  mocks.runAction.mockReset();
  mocks.health.mockReturnValue("online");
  mocks.sseConnected.mockReturnValue(true);
  mocks.proofListeners.clear();
  mocks.watchProofExecution.mockClear();
});

test("keeps loading distinct from an empty Proof library", async () => {
  let finish!: (value: { proofs: readonly ChangeVerification[] }) => void;
  mocks.runAction.mockImplementation(
    () =>
      new Promise<{ proofs: readonly ChangeVerification[] }>((resolve) => {
        finish = resolve;
      }),
  );
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() =>
    expect(root.querySelector('[aria-label="Loading Proofs"]')).not.toBeNull(),
  );
  expect(root.textContent).not.toContain("No Proofs yet");

  finish({ proofs: [] });
  await vi.waitFor(() => expect(root.textContent).toContain("No Proofs yet"));
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent?.trim() === "Prepare a Proof",
    ),
  ).toHaveLength(1);

  dispose();
  root.remove();
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
    if (operationId === "proof.inspect") {
      return { proof, history: [proof], publications: [publication], publicationOutbox: [] };
    }
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
  expect(root.textContent).toContain("Verification plan");
  expect(root.textContent).toContain("2 verification cells · 1 required · 1 advisory");
  expect(root.textContent).toContain("About 2 minutes");
  expect(root.textContent).toContain("Pilot");
  expect(root.textContent).toContain("Required");
  expect(root.textContent).toContain("Advisory");
  expect(root.textContent).toContain("Settings language");
  expect(root.textContent).toContain("Web · Production");
  expect(root.textContent).toContain("Coverage");
  expect(root.textContent).toContain("Risk and cleanup");
  expect(root.textContent).toContain("Evidence");
  expect(root.textContent).toContain("Why selected");
  expect(root.textContent).toContain("cell-ar-pilot");
  expect(root.textContent).toContain("cell-ar-advisory");
  expect(root.textContent).toContain("The changed localization resource is bound to this Test.");
  expect(root.textContent).toContain(
    "Visual evidence adds useful confidence without blocking merge.",
  );
  expect(root.textContent).toContain(
    "On Compact Chromium Arabic · Chromium · 390 × 844 · Arabic · Dark",
  );
  expect(root.textContent).toContain("Cleanup required");
  expect(root.textContent).toContain("Technical details");
  expect(root.textContent).not.toContain("Technical plan identity");
  expect(root.textContent).toContain("Primary action overlaps the Arabic description by 22 px.");
  expect(root.textContent).toContain("Physical iOS is advisory for this repository.");
  await vi.waitFor(() => expect(root.textContent).toContain("GitHub · failure"));
  expect(root.querySelector<HTMLAnchorElement>('a[href$="/runs/42"]')?.textContent).toContain(
    "Open merge check",
  );
  expect(root.textContent).toContain(
    "Repair the first causal regression, then create a new Proof for the new head.",
  );
  expect(root.textContent).toContain("Technical details");
  expect(root.textContent).toContain(headSha);
  expect(root.textContent).toContain(
    `web-production · web · source ${headSha} · artifact ${digest}`,
  );
  expect(root.textContent).toContain("cell-ar-pilot");
  expect(root.textContent).toContain(
    "settings/settings-language@3 · target chromium-compact-ar · build web-production",
  );
  expect(root.textContent).toContain(digest);
  expect(root.textContent).toContain(`github · ${proof.id} · Check #42 · completed · failure`);
  expect(root.textContent).toContain(`head ${headSha} · digest ${digest}`);
  expect(root.textContent).not.toMatch(/campaign|lease|raw operation/i);
  const planCells = root.querySelector<HTMLOListElement>("[data-proof-plan-cells]");
  expect(planCells?.tagName).toBe("OL");
  expect(planCells?.children).toHaveLength(2);
  expect(planCells?.querySelector("dl")?.className).toContain("max-[700px]:grid-cols-1");
  const proofRows = root.querySelectorAll<HTMLButtonElement>("[data-proof-list-row]");
  expect(proofRows).toHaveLength(1);
  expect(proofRows[0]?.className).toContain("min-h-11");
  expect(proofRows[0]?.className).toContain("flex");
  expect(root.querySelectorAll("[data-proof-identity-ledger]")).toHaveLength(1);

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

test("keeps Proof navigation dense and uses a neutral status for superseded work", async () => {
  const superseded = {
    ...proof,
    id: "proof-superseded",
    state: "superseded",
    decision: undefined,
  } as unknown as ChangeVerification;
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: [proof, superseded] };
    if (operationId === "proof.inspect") {
      return { proof, history: [proof], publications: [], publicationOutbox: [] };
    }
    throw new Error(`unexpected ${operationId}`);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() =>
    expect(root.querySelectorAll<HTMLButtonElement>("[data-proof-list-row]")).toHaveLength(2),
  );
  const supersededRow = root.querySelector<HTMLButtonElement>('[data-proof-state="superseded"]');
  expect(supersededRow?.className).toContain("min-h-11");
  expect(supersededRow?.querySelector('[data-proof-status-tone="idle"]')).not.toBeNull();
  expect(supersededRow?.getAttribute("aria-label")).toContain("Superseded");

  dispose();
  root.remove();
});

test("turns an exhausted merge check into one explicit recovery action", async () => {
  let inspectionCount = 0;
  mocks.runAction.mockImplementation(async (operationId: string, input: unknown) => {
    if (operationId === "proof.list") return { proofs: [proof] };
    if (operationId === "proof.inspect") {
      inspectionCount += 1;
      return {
        proof,
        history: [proof],
        publications: [],
        publicationOutbox: [exhaustedPublication],
      };
    }
    if (operationId === "proof.publication.retry") {
      return { proof, publication: exhaustedPublication, disposition: "accepted" };
    }
    throw new Error(`unexpected ${operationId}: ${JSON.stringify(input)}`);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <>
        <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />
        <ConfirmDialogHost />
      </>
    ),
    root,
  );

  await vi.waitFor(() => expect(root.textContent).toContain("Merge check needs attention"));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Retry merge check")
    ?.click();
  await vi.waitFor(() => expect(root.textContent).toContain("Retry this merge check?"));
  const confirmButtons = [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.trim() === "Retry merge check",
  );
  confirmButtons.at(-1)?.click();

  await vi.waitFor(() =>
    expect(mocks.runAction).toHaveBeenCalledWith("proof.publication.retry", {
      proofId: proof.id,
      publicationId: exhaustedPublication.id,
      expectedProofVersion: proof.version,
      reason: "The operator explicitly retried the exhausted merge check from Relay.",
      confirm: true,
    }),
  );
  await vi.waitFor(() => expect(inspectionCount).toBeGreaterThan(1));

  dispose();
  root.remove();
});

test("a newer exhausted Proof revision is not hidden by an older merge receipt", async () => {
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: [proof] };
    if (operationId === "proof.inspect") {
      return {
        proof,
        history: [proof],
        publications: [{ ...publication, proofVersion: proof.version - 1 }],
        publicationOutbox: [exhaustedPublication],
      };
    }
    throw new Error(`unexpected ${operationId}`);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() => expect(root.textContent).toContain("Merge check needs attention"));
  expect(root.textContent).not.toContain("Check #42");
  expect(root.textContent).toContain("Retry merge check");

  dispose();
  root.remove();
});

test("runs an approved Proof through one server-owned outcome", async () => {
  const readyProof = {
    ...proof,
    version: 2,
    state: "ready",
    decision: undefined,
    runIds: [],
    evidenceDigests: [],
    firstCausalFailure: undefined,
    residualRisk: [],
    smallestNextVerification: {
      kind: "run-pilot",
      reason: "Run the deterministic pilot.",
    },
    lastMutation: { ...proof.lastMutation, previousVersion: 1, version: 2 },
  } as unknown as ChangeVerification;
  const runningProof = {
    ...readyProof,
    version: 3,
    state: "running-pilot",
    lastMutation: { ...readyProof.lastMutation, previousVersion: 2, version: 3 },
  } as unknown as ChangeVerification;
  const provedProof = {
    ...runningProof,
    version: 5,
    state: "proved",
    decision: "proved",
    runIds: ["run-pilot", "run-advisory"],
    smallestNextVerification: {
      kind: "none",
      reason: "No further verification is required for this exact change.",
    },
    lastMutation: { ...runningProof.lastMutation, previousVersion: 4, version: 5 },
  } as unknown as ChangeVerification;
  let runStarted = false;
  const liveInspections: Array<(value: unknown) => void> = [];
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: [readyProof] };
    if (operationId === "proof.inspect") {
      if (runStarted) {
        return new Promise((resolve) => liveInspections.push(resolve));
      }
      return { proof: readyProof, history: [readyProof], publications: [], publicationOutbox: [] };
    }
    if (operationId === "proof.run") {
      runStarted = true;
      return {
        proof: runningProof,
        execution: {
          id: "proof-execution",
          proofId: proof.id,
          status: "running",
          cursor: 0,
          total: 2,
          runIds: [],
          deadlineAt: Date.now() + 60_000,
          nextAction: "inspect",
        },
      };
    }
    throw new Error(`unexpected ${operationId}`);
  });

  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} liveRefreshMs={10} />,
    root,
  );

  await vi.waitFor(() => expect(root.textContent).toContain("Run pilot"));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Run pilot")
    ?.click();

  await vi.waitFor(() =>
    expect(mocks.runAction).toHaveBeenCalledWith("proof.run", {
      proofId: readyProof.id,
      expectedVersion: readyProof.version,
      wait: false,
    }),
  );
  await vi.waitFor(() => expect(root.textContent).toContain("Running verification"));
  expect(root.textContent).not.toContain("Resume pilot");
  expect(root.textContent).toContain("0 of 2 verification cells complete");

  await vi.waitFor(() => expect(mocks.proofListeners.get(proof.id)?.size).toBe(1));
  for (const listener of mocks.proofListeners.get(proof.id) ?? []) {
    listener({ kind: "changed", cursor: 1, status: "running" });
  }
  await vi.waitFor(() => expect(liveInspections).toHaveLength(1));
  liveInspections.shift()!({
    proof: runningProof,
    history: [readyProof, runningProof],
    publications: [],
    publicationOutbox: [],
    execution: {
      id: "proof-execution",
      proofId: proof.id,
      status: "running",
      cursor: 1,
      total: 2,
      runIds: ["run-pilot"],
      deadlineAt: Date.now() + 60_000,
      nextAction: "inspect",
    },
  });
  await vi.waitFor(() => expect(root.textContent).toContain("1 of 2 verification cells complete"));
  expect(root.textContent).not.toContain("Resume pilot");

  for (const listener of mocks.proofListeners.get(proof.id) ?? []) {
    listener({ kind: "changed", cursor: 2, status: "completed" });
  }
  await vi.waitFor(() => expect(liveInspections).toHaveLength(1));
  liveInspections.shift()!({
    proof: provedProof,
    history: [readyProof, runningProof, provedProof],
    publications: [],
    publicationOutbox: [],
    execution: {
      id: "proof-execution",
      proofId: proof.id,
      status: "completed",
      cursor: 2,
      total: 2,
      runIds: ["run-pilot", "run-advisory"],
      deadlineAt: Date.now() + 60_000,
      nextAction: "complete",
    },
  });
  await vi.waitFor(() => expect(root.textContent).toContain("Open run-pilot"));
  expect(root.textContent).not.toContain("Verification complete");
  expect(root.textContent).not.toContain("2 of 2 verification cells complete");
  expect(root.textContent).not.toContain("Next required action");

  dispose();
  root.remove();
});

test("manual refresh re-inspects the selected Proof instead of keeping a stale detail", async () => {
  let inspectCount = 0;
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: [proof] };
    if (operationId === "proof.inspect") {
      inspectCount += 1;
      return {
        proof: {
          ...proof,
          residualRisk: [inspectCount === 1 ? "Initial risk." : "Refreshed risk."],
        },
        history: [proof],
        publications: [],
        publicationOutbox: [],
      };
    }
    throw new Error(`unexpected ${operationId}`);
  });

  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() => expect(root.textContent).toContain("Initial risk."));
  root.querySelector<HTMLButtonElement>('button[aria-label="Refresh Proofs"]')?.click();
  await vi.waitFor(() => expect(root.textContent).toContain("Refreshed risk."));
  expect(inspectCount).toBe(2);

  dispose();
  root.remove();
});

test("starts from the active workspace and never asks humans to type revision plumbing", async () => {
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
  let workspaceFrozen = false;
  let finishStart!: () => void;
  const startBarrier = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  mocks.runAction.mockImplementation(async (operationId: string) => {
    if (operationId === "proof.list") return { proofs: created ? [createdProof] : [] };
    if (operationId === "workspace.change.inspect") {
      return {
        change: {
          status: "resolved",
          workspace: { name: "settings" },
          repository: "acme/settings",
          branch: "feature/arabic-settings",
          head: { sha: "b".repeat(40), label: "Add Arabic Settings support" },
          base: { sha: "a".repeat(40), label: "main" },
          baseCandidates: [{ ref: "origin/main", sha: "a".repeat(40), label: "main" }],
          changedFileCount: 3,
          changedFiles: ["src/settings.tsx", "src/rtl.css", "strings/ar.json"],
          localChangeCount: workspaceFrozen ? 0 : 1,
          localChanges: workspaceFrozen ? [] : ["src/settings.tsx"],
          readyForProof: workspaceFrozen,
          blockers: workspaceFrozen ? [] : ["1 local change is not part of the frozen head."],
        },
      };
    }
    if (operationId === "proof.prepare") {
      await startBarrier;
      created = true;
      return { proof: createdProof, receipt: createdProof.lastMutation, disposition: "created" };
    }
    if (operationId === "proof.inspect") {
      return {
        proof: createdProof,
        history: [createdProof],
        publications: [],
        publicationOutbox: [],
      };
    }
    throw new Error(`unexpected ${operationId}`);
  });

  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <ChangesWorkspace onOpenRun={vi.fn()} onOpenMap={vi.fn()} />, root);

  await vi.waitFor(() => expect(root.textContent).toContain("No Proofs yet"));
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "Prepare a Proof")
    ?.click();
  await vi.waitFor(() => expect(root.textContent).toContain("Add Arabic Settings support"));
  expect(root.textContent).toContain("feature/arabic-settings · 3 changed files");
  expect(root.textContent).toContain(
    "Restored tabs and previous-session views never choose the change.",
  );
  expect(root.textContent).toContain("1 local change is not part of the frozen head.");
  expect(root.querySelector("#proof-repository")).toBeNull();
  expect(root.querySelector("#proof-baseSha")).toBeNull();
  expect(root.querySelector("#proof-headSha")).toBeNull();
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Prepare Proof",
    )?.disabled,
  ).toBe(true);

  workspaceFrozen = true;
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.getAttribute("aria-label") === "Inspect the active workspace again")
    ?.click();
  await vi.waitFor(() => expect(root.textContent).not.toContain("not part of the frozen head"));

  enterValue(root, "proof-pullRequest", "184");
  enterValue(root, "proof-summary", "Add Arabic Settings support");
  enterValue(root, "proof-acceptanceCriteria", "Settings render in Arabic without RTL overlap");
  const form = root.querySelector<HTMLFormElement>('form[aria-label="Prepare a Proof"]')!;
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(mocks.runAction).toHaveBeenCalledWith("proof.prepare", {
      pullRequest: 184,
      agentClaim: {
        summary: "Add Arabic Settings support",
        acceptanceCriteria: ["Settings render in Arabic without RTL overlap"],
      },
      policy: { id: "relay.verify-change", version: 2 },
    }),
  );
  expect(
    mocks.runAction.mock.calls.filter(([operationId]) => operationId === "proof.prepare"),
  ).toHaveLength(1);
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Preparing…",
    )?.disabled,
  ).toBe(true);

  finishStart();
  await vi.waitFor(() => expect(root.textContent).toContain("Awaiting build"));
  expect(root.textContent).toContain("Bind an exact build for the head commit.");

  dispose();
  root.remove();
});
