import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ApprovalPolicyInput,
  ChangeProofCaseResult,
  ChangeVerification,
} from "@relay/protocol";
import {
  agentRepairPacketForDecision,
  decideChangeVerification,
  providerCheckForChangeProof,
  providerCheckForStoredChangeProof,
  recordChangeVerificationDecision,
} from "./change-proof-decision.js";
import {
  advanceChangeVerification,
  createChangeVerification,
  readChangeVerificationHistory,
} from "./change-verification-store.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import { materializeChangeVerificationIntegrity } from "./change-proof-integrity.js";
import { evaluateChangeDecisionPolicy } from "./change-decision-policy.js";
import { canonicalSha256 } from "./canonical-json.js";

const headSha = "2".repeat(40);
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};
const safeExecutionRiskDigest = canonicalSha256(safeExecutionRisk);

function targetCase(id: string): ChangeVerification["selection"]["targetCases"][number] {
  return {
    id,
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId: "web",
      platform: "browser",
      identity: { kind: "browser-target", value: "web" },
    },
    targetProfile: {
      id: `web:${id}`,
      targetId: "web",
      source: "browser",
      platform: "browser",
      name: id,
      viewport: { width: 390, height: 844 },
      browserCaseProfile: {
        schemaVersion: 1,
        engine: id.includes("webkit") ? "webkit" : "chromium",
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
    dimensions: { locale: "ar", engine: id.includes("webkit") ? "webkit" : "chromium" },
    required: true,
  };
}

function proof(): ChangeVerification {
  return {
    schemaVersion: 2,
    id: "proof-1",
    organizationId: "acme",
    projectId: "relay",
    version: 3,
    state: "running",
    change: {
      repository: "acme/settings",
      baseSha: "1".repeat(40),
      headSha,
      pullRequest: 184,
    },
    builds: [
      {
        id: "web",
        platform: "web",
        artifactDigest: digest("a"),
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
          appMapRevision: 7,
          reason: "Settings localization changed.",
          confidence: "definite",
        },
      ],
      targetCases: [targetCase("chromium-compact-ar"), targetCase("webkit-compact-ar")],
      cells: [
        {
          id: "cell-settings-chromium",
          journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 7 },
          targetCaseId: "chromium-compact-ar",
          buildId: "web",
          requirement: "required",
          selectionReason: "Chromium compact Arabic is required coverage.",
          dimensions: { locale: "ar", engine: "chromium" },
          executionRisk: safeExecutionRisk,
          executionRiskDigest: safeExecutionRiskDigest,
          evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
          cleanupRequired: false,
        },
        {
          id: "cell-settings-webkit",
          journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 7 },
          targetCaseId: "webkit-compact-ar",
          buildId: "web",
          requirement: "required",
          selectionReason: "WebKit compact Arabic is required coverage.",
          dimensions: { locale: "ar", engine: "webkit" },
          executionRisk: safeExecutionRisk,
          executionRiskDigest: safeExecutionRiskDigest,
          evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
          cleanupRequired: false,
        },
      ],
      pilotCellId: "cell-settings-chromium",
    },
    planApproval: {
      decisionId: "decision-1",
      approvedBy: "human:reviewer",
      approvedAt: 200,
      reason: "Reviewed exact plan.",
    },
    policy: { id: "relay.default", version: 3 },
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: { kind: "expand", reason: "Run required coverage." },
    requestedBy: "agent:coder",
    updatedBy: "agent:relay",
    lastMutation: {
      schemaVersion: 1,
      requestId: "request-run",
      requestDigest: digest("f"),
      action: "start-required-coverage",
      actorId: "agent:relay",
      proofId: "proof-1",
      previousVersion: 2,
      version: 3,
      at: 300,
    },
    createdAt: 100,
    updatedAt: 300,
  };
}

function result(
  targetCaseId: string,
  overrides: Partial<ChangeProofCaseResult> = {},
): ChangeProofCaseResult {
  return {
    appMapId: "settings",
    testId: "settings-language",
    targetCaseId,
    runId: `run-${targetCaseId}`,
    sourceSha: headSha,
    buildId: "web",
    artifactDigest: digest("a"),
    outcome: "passed",
    evidenceDigests: [digest(targetCaseId.startsWith("chromium") ? "b" : "c")],
    evidenceComplete: true,
    selectorResolution: "deterministic",
    inputOutcome: "reconciled",
    cleanup: "restored",
    ...overrides,
  };
}

function policyInput(
  overrides: {
    evidence?: Partial<ApprovalPolicyInput["evidence"]>;
    verification?: Partial<ApprovalPolicyInput["verification"]>;
  } = {},
): ApprovalPolicyInput {
  return {
    schemaVersion: 1,
    policy: { id: "relay.verify-change", version: 1 },
    executionRisk: {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: [],
      cleanupRequired: false,
    },
    confirmationSatisfied: true,
    evidence: {
      status: "complete",
      requiredChannels: ["frozen-run", "trace-pack"],
      missing: [],
      tracePackDigests: [digest("a")],
      ...overrides.evidence,
    },
    verification: {
      requiredPaths: "passed",
      selectorResolution: "deterministic",
      unresolved: [],
      ...overrides.verification,
    },
    findings: [],
  };
}

test("offline and durable Proof adapters share one ordered decision vocabulary", () => {
  const cases = [
    {
      name: "proved",
      results: [result("chromium-compact-ar"), result("webkit-compact-ar")],
      policy: policyInput(),
      expectedPolicy: "proved" as const,
      expectedProof: "proved" as const,
      expectedRules: ["verification.proved"],
    },
    {
      name: "rejected",
      results: [
        result("chromium-compact-ar", {
          outcome: "rejected",
          failure: { summary: "The required assertion failed.", evidenceRefs: [] },
        }),
      ],
      policy: policyInput({ verification: { requiredPaths: "failed" } }),
      expectedPolicy: "rejected" as const,
      expectedProof: "rejected" as const,
      expectedRules: ["verification.required-path-lost"],
    },
    {
      name: "needs-review",
      results: [
        result("chromium-compact-ar", { selectorResolution: "ambiguous" }),
        result("webkit-compact-ar"),
      ],
      policy: policyInput({ verification: { selectorResolution: "ambiguous" } }),
      expectedPolicy: "needs-review" as const,
      expectedProof: "needs-review" as const,
      expectedRules: ["verification.selector-ambiguous"],
    },
    {
      name: "insufficient-evidence",
      results: [result("chromium-compact-ar")],
      policy: policyInput({
        evidence: { status: "partial", missing: ["webkit-compact-ar"] },
        verification: { requiredPaths: "unproven" },
      }),
      expectedPolicy: "insufficient-evidence" as const,
      expectedProof: "insufficient-evidence" as const,
      expectedRules: ["evidence.incomplete"],
    },
  ] as const;

  for (const item of cases) {
    const policy = evaluateChangeDecisionPolicy(item.policy);
    const durable = decideChangeVerification({ proof: proof(), caseResults: item.results });
    assert.equal(policy.decision, item.expectedPolicy, item.name);
    assert.deepEqual(policy.ruleIds, item.expectedRules, item.name);
    assert.equal(durable.decision, item.expectedProof, item.name);
  }
});

test("an advisory cell contributes residual risk without gaining merge authority", () => {
  const base = proof();
  const advisoryProof: ChangeVerification = {
    ...base,
    selection: {
      ...base.selection,
      cells: base.selection.cells!.map((cell) =>
        cell.id === "cell-settings-webkit" ? { ...cell, requirement: "advisory" as const } : cell,
      ),
    },
  };
  const decision = decideChangeVerification({
    proof: advisoryProof,
    caseResults: [
      result("chromium-compact-ar"),
      result("webkit-compact-ar", {
        outcome: "rejected",
        failure: { summary: "Advisory WebKit layout changed.", evidenceRefs: [digest("c")] },
      }),
    ],
  });

  assert.equal(decision.decision, "proved");
  assert.equal(decision.summary.required, 1);
  assert.match(decision.residualRisk[0]!, /Advisory target case webkit-compact-ar/u);
});

test("cell identity distinguishes reviewed dimensions on the same journey and target", () => {
  const base = proof();
  const first = base.selection.cells![0]!;
  const dimensionProof: ChangeVerification = {
    ...base,
    selection: {
      ...base.selection,
      cells: [
        { ...first, dimensions: { ...first.dimensions, theme: "dark" } },
        {
          ...first,
          id: "cell-settings-chromium-light",
          selectionReason: "Light theme is a separately reviewed required case.",
          dimensions: { ...first.dimensions, theme: "light" },
        },
      ],
    },
  };
  const decision = decideChangeVerification({
    proof: dimensionProof,
    caseResults: [
      result("chromium-compact-ar", { cellId: first.id }),
      result("chromium-compact-ar", {
        cellId: "cell-settings-chromium-light",
        runId: "run-chromium-light",
        evidenceDigests: [digest("d")],
      }),
    ],
  });

  assert.equal(decision.decision, "proved");
  assert.equal(decision.summary.required, 2);
  assert.throws(() =>
    decideChangeVerification({
      proof: dimensionProof,
      caseResults: [result("chromium-compact-ar")],
    }),
  );
});

test("proves only the complete required journey and target matrix", () => {
  const decision = decideChangeVerification({
    proof: proof(),
    caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
  });
  assert.equal(decision.decision, "proved");
  assert.deepEqual(decision.summary, {
    required: 2,
    passed: 2,
    rejected: 0,
    needsReview: 0,
    insufficient: 0,
    missing: 0,
  });
  assert.equal(decision.smallestNextVerification.kind, "none");
  const check = providerCheckForChangeProof({ proof: proof(), decision });
  assert.equal(check.headSha, headSha);
  assert.equal(check.conclusion, "success");
  assert.match(check.text, /Required cases: 2\/2 passed/);
});

test("durable decisions fail closed when a required cell has no risk authority", () => {
  const base = proof();
  const value: ChangeVerification = {
    ...base,
    selection: {
      ...base.selection,
      cells: base.selection.cells!.map((cell, index) =>
        index === 0
          ? (({ executionRisk: _risk, executionRiskDigest: _digest, ...withoutAuthority }) =>
              withoutAuthority)(cell)
          : cell,
      ),
    },
  };
  const decision = decideChangeVerification({
    proof: value,
    caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
  });
  assert.equal(decision.decision, "needs-review");
  assert.deepEqual(decision.ruleIds, ["execution.authority-missing"]);
  assert.match(decision.coverageGaps[0]!, /missing or mismatched execution authority/u);
});

test("durable decisions fail closed when a required cell has no evidence-policy authority", () => {
  const base = proof();
  const value: ChangeVerification = {
    ...base,
    selection: {
      ...base.selection,
      cells: base.selection.cells!.map((cell, index) =>
        index === 0
          ? (({ evidencePolicyDigest: _digest, ...withoutAuthority }) => withoutAuthority)(cell)
          : cell,
      ),
    },
  };
  const decision = decideChangeVerification({
    proof: value,
    caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
  });
  assert.equal(decision.decision, "needs-review");
  assert.deepEqual(decision.ruleIds, ["execution.authority-missing"]);
  assert.match(decision.coverageGaps[0]!, /missing or mismatched execution authority/u);
});

test("durable decisions reject a passing Run under prohibited frozen risk", () => {
  const prohibited = {
    ...safeExecutionRisk,
    level: "prohibited" as const,
    confirmation: "human-only" as const,
    reasons: [{ code: "reviewed-effect.purchase", explanation: "Purchase effect." }],
    externalEffects: ["purchase" as const],
  };
  const value: ChangeVerification = {
    ...proof(),
    selection: {
      ...proof().selection,
      cells: proof().selection.cells!.map((cell, index) =>
        index === 0
          ? {
              ...cell,
              executionRisk: prohibited,
              executionRiskDigest: canonicalSha256(prohibited),
            }
          : cell,
      ),
    },
  };
  const decision = decideChangeVerification({
    proof: value,
    caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
  });
  assert.equal(decision.decision, "rejected");
  assert.equal(decision.state, "rejected");
});

test("durable decisions reject a forged cell risk digest", () => {
  const value: ChangeVerification = {
    ...proof(),
    selection: {
      ...proof().selection,
      cells: proof().selection.cells!.map((cell, index) =>
        index === 0 ? { ...cell, executionRiskDigest: digest("0") } : cell,
      ),
    },
  };
  const decision = decideChangeVerification({
    proof: value,
    caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
  });
  assert.equal(decision.decision, "needs-review");
  assert.deepEqual(decision.ruleIds, ["execution.authority-missing"]);
});

test("missing or incomplete mandatory proof is action-required, never green", () => {
  const missing = decideChangeVerification({
    proof: proof(),
    caseResults: [result("chromium-compact-ar")],
  });
  assert.equal(missing.decision, "insufficient-evidence");
  assert.equal(missing.summary.missing, 1);
  assert.equal(missing.smallestNextVerification.targetCaseId, "webkit-compact-ar");
  assert.equal(
    providerCheckForChangeProof({ proof: proof(), decision: missing }).conclusion,
    "action-required",
  );

  const incomplete = decideChangeVerification({
    proof: proof(),
    caseResults: [
      result("chromium-compact-ar", { evidenceComplete: false }),
      result("webkit-compact-ar"),
    ],
  });
  assert.equal(incomplete.decision, "insufficient-evidence");
  assert.match(incomplete.coverageGaps[0]!, /did not produce complete mandatory proof/);
});

test("a required cell cannot accept a not-required cleanup result", () => {
  const base = proof();
  const value: ChangeVerification = {
    ...base,
    selection: {
      ...base.selection,
      targetCases: base.selection.targetCases.map((targetCase) => ({
        ...targetCase,
        cleanupRequired: true,
      })),
      cells: base.selection.cells!.map((cell) => ({ ...cell, cleanupRequired: true })),
    },
  };
  assert.throws(
    () =>
      decideChangeVerification({
        proof: value,
        caseResults: [result("chromium-compact-ar", { cleanup: "not-required" })],
      }),
    /omits cleanup proof required by its Verification Cell/u,
  );
});

test("provider checks distinguish infrastructure failure from ordinary missing evidence", () => {
  const infrastructure = result("chromium-compact-ar", {
    outcome: "infrastructure-failure",
    evidenceComplete: false,
    failure: {
      summary: "The required browser worker exited before the page was available.",
      evidenceRefs: [digest("e")],
    },
  });
  const decision = decideChangeVerification({ proof: proof(), caseResults: [infrastructure] });
  assert.equal(decision.decision, "insufficient-evidence");
  assert.ok(decision.coverageGaps.some((gap) => gap.startsWith("Infrastructure failure in Run")));
  const check = providerCheckForChangeProof({ proof: proof(), decision });
  assert.equal(check.conclusion, "action-required");
  assert.equal(check.classification, "infrastructure-failure");
  assert.equal(check.title, "Relay Proof — INFRASTRUCTURE FAILURE");
  const stored = materializeChangeVerificationIntegrity({
    ...proof(),
    state: decision.state,
    decision: decision.decision,
    runIds: decision.runIds,
    evidenceDigests: decision.evidenceDigests,
    coverageGaps: decision.coverageGaps,
    residualRisk: decision.residualRisk,
    smallestNextVerification: decision.smallestNextVerification,
  });
  assert.equal(
    providerCheckForStoredChangeProof({ proof: stored }).classification,
    "infrastructure-failure",
  );
});

test("a definitive causal regression rejects and creates one bounded repair packet", () => {
  const failed = result("chromium-compact-ar", {
    outcome: "rejected",
    failure: {
      checkId: "rtl-overlap",
      summary: "Primary action overlaps the Arabic description by 22 px.",
      expected: "Primary action does not overlap translated content.",
      observed: "Primary action overlaps the description by 22 px.",
      evidenceRefs: [digest("d")],
      relevantLogs: ["visual-check: overlap=22"],
      suggestedScope: ["src/settings/LanguagePanel.tsx"],
    },
  });
  const decision = decideChangeVerification({ proof: proof(), caseResults: [failed] });
  assert.equal(decision.decision, "rejected", "a definitive failure dominates missing expansion");
  assert.equal(decision.firstCausalFailure?.checkId, "rtl-overlap");
  assert.equal(providerCheckForChangeProof({ proof: proof(), decision }).conclusion, "failure");
  const packet = agentRepairPacketForDecision({ proof: proof(), caseResults: [failed] });
  assert.equal(packet?.proofId, "proof-1");
  assert.equal(packet?.targetCaseId, "chromium-compact-ar");
  assert.deepEqual(packet?.rerun, {
    operationId: "proof.rerun-affected",
    proofId: "proof-1",
  });
  assert.deepEqual(packet?.suggestedScope, ["src/settings/LanguagePanel.tsx"]);
});

test("ambiguous selectors and unreconciled input require review", () => {
  for (const drift of [
    { selectorResolution: "ambiguous" as const },
    { inputOutcome: "unreconciled" as const },
    { outcome: "needs-review" as const },
  ]) {
    const decision = decideChangeVerification({
      proof: proof(),
      caseResults: [result("chromium-compact-ar", drift), result("webkit-compact-ar")],
    });
    assert.equal(decision.decision, "needs-review");
    assert.equal(
      providerCheckForChangeProof({ proof: proof(), decision }).conclusion,
      "action-required",
    );
  }
});

test("forged head, artifact, build, target, and duplicate result identities fail closed", () => {
  const valid = result("chromium-compact-ar");
  for (const forged of [
    { ...valid, sourceSha: "3".repeat(40) },
    { ...valid, artifactDigest: digest("e") },
    { ...valid, buildId: "other" },
    { ...valid, targetCaseId: "other" },
    { ...valid, testId: "other" },
  ]) {
    assert.throws(() => decideChangeVerification({ proof: proof(), caseResults: [forged] }));
  }
  assert.throws(
    () => decideChangeVerification({ proof: proof(), caseResults: [valid, valid] }),
    /identities must be unique/,
  );
});

test("the server-owned decision transition appends Run and evidence identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-proof-decision-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const scope = { organizationId: "acme", projectId: "relay" } as const;
  try {
    const template = proof();
    const created = await createChangeVerification({
      ...scope,
      id: template.id,
      change: template.change,
      builds: template.builds,
      selection: template.selection,
      policy: template.policy,
      requestedBy: "agent:coder",
      actorId: "agent:coder",
      requestId: "start",
      requestDigest: digest("1"),
      at: 100,
    });
    const ready = await advanceChangeVerification({
      ...scope,
      proofId: created.id,
      expectedVersion: created.version,
      state: "ready",
      actorId: "human:reviewer",
      requestId: "approve",
      requestDigest: digest("2"),
      action: "approve-plan",
      at: 200,
      planApproval: template.planApproval,
    });
    const running = await advanceChangeVerification({
      ...scope,
      proofId: ready.id,
      expectedVersion: ready.version,
      state: "running-pilot",
      actorId: "system:relay",
      requestId: "pilot",
      requestDigest: digest("3"),
      action: "start-pilot",
      at: 300,
    });
    const proved = await recordChangeVerificationDecision({
      ...scope,
      proofId: running.id,
      expectedVersion: running.version,
      caseResults: [result("chromium-compact-ar"), result("webkit-compact-ar")],
      actorId: "system:relay",
      requestId: "decision",
      requestDigest: digest("4"),
      at: 400,
    });
    assert.equal(proved.state, "proved");
    assert.deepEqual(proved.runIds, ["run-chromium-compact-ar", "run-webkit-compact-ar"]);
    assert.deepEqual(proved.evidenceDigests, [digest("b"), digest("c")]);
    assert.deepEqual(
      (await readChangeVerificationHistory(scope, proved.id)).map(({ state }) => state),
      ["planning", "ready", "running-pilot", "proved"],
    );
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("provider publication projects only the durable terminal Proof", () => {
  const source = proof();
  const decided = decideChangeVerification({
    proof: source,
    caseResults: [result("chromium-compact-ar")],
  });
  const stored = {
    ...source,
    state: decided.state,
    decision: decided.decision,
    runIds: decided.runIds,
    evidenceDigests: decided.evidenceDigests,
    coverageGaps: decided.coverageGaps,
    residualRisk: decided.residualRisk,
    smallestNextVerification: decided.smallestNextVerification,
    firstCausalFailure: decided.firstCausalFailure,
  } as ChangeVerification;
  const check = providerCheckForStoredChangeProof({ proof: stored });
  assert.equal(check.conclusion, "action-required");
  assert.match(check.text, /Required cases: 2/u);
  assert.match(check.text, /Recorded Runs: 1/u);
  assert.match(check.text, /Missing required Run.*cell-settings-webkit/u);
  assert.throws(() => providerCheckForStoredChangeProof({ proof: source }), /terminal Proof/u);
});

test("provider publication makes superseded Proofs explicitly action-required", () => {
  const source = proof();
  const superseded = {
    ...source,
    state: "superseded",
    decision: undefined,
    supersededByProofId: "proof-2",
  } as ChangeVerification;
  const check = providerCheckForStoredChangeProof({ proof: superseded });
  assert.equal(check.conclusion, "action-required");
  assert.equal(check.classification, "superseded");
  assert.match(check.summary, /proof-2/u);
  assert.match(check.text, /Superseded by Proof: proof-2/u);
});
