import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGE_VERIFICATION_STATES,
  parseChangeVerification,
  type ChangeVerification,
} from "./change-verification.js";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;

function fixture(overrides: Partial<ChangeVerification> = {}): ChangeVerification {
  return {
    schemaVersion: 2,
    id: "proof-1",
    organizationId: "acme",
    projectId: "relay",
    version: 1,
    state: "ready",
    change: {
      repository: "acme/settings",
      baseSha,
      headSha,
      pullRequest: 184,
      agentClaim: {
        summary: "Added Arabic settings",
        acceptanceCriteria: ["Settings render in Arabic and preserve RTL layout"],
      },
    },
    builds: [
      {
        id: "web",
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
          appMapRevision: 7,
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
            capabilities: ["snapshot", "screenshot", "tap", "type"],
            observedAt: 100,
          },
          dimensions: { locale: "ar", viewport: "compact" },
          required: true,
        },
      ],
      cells: [
        {
          id: "cell-settings-chromium",
          journey: { appMapId: "settings", testId: "settings-language", appMapRevision: 7 },
          targetCaseId: "chromium-compact-ar",
          buildId: "web",
          requirement: "required",
          selectionReason: "Compact Arabic web is required for this localization change.",
          dimensions: { locale: "ar", viewport: "compact" },
          cleanupRequired: false,
        },
      ],
      pilotCellId: "cell-settings-chromium",
    },
    planApproval: {
      decisionId: "decision-1",
      approvedBy: "human:reviewer",
      approvedAt: 100,
      reason: "The selected journeys and targets cover the stated change.",
    },
    policy: { id: "relay.default", version: 3 },
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: { kind: "run-pilot", reason: "Run the representative case." },
    requestedBy: "agent:coder",
    updatedBy: "agent:coder",
    lastMutation: {
      schemaVersion: 1,
      requestId: "request-1",
      requestDigest: digest,
      action: "start",
      actorId: "agent:coder",
      proofId: "proof-1",
      previousVersion: 0,
      version: 1,
      at: 100,
    },
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("Change Verification freezes one exact change, build, plan, and policy", () => {
  assert.deepEqual(parseChangeVerification(fixture()), fixture());
  assert.throws(() =>
    parseChangeVerification(
      fixture({
        selection: {
          ...fixture().selection,
          affectedJourneys: fixture().selection.affectedJourneys.map(
            ({ appMapRevision: _revision, ...journey }) => journey,
          ),
        },
      }),
    ),
  );
  assert.throws(() =>
    parseChangeVerification({
      ...fixture(),
      builds: [{ ...fixture().builds[0]!, sourceSha: baseSha }],
    }),
  );
  assert.throws(() => parseChangeVerification({ ...fixture(), extra: true }));
  assert.throws(() =>
    parseChangeVerification({
      ...fixture(),
      change: { ...fixture().change, unexpected: true },
    }),
  );
});

test("legacy v1 Proofs migrate fail-closed before execution or merge", () => {
  const { planApproval: _approval, lastMutation: _receipt, ...legacy } = fixture();
  const migrated = parseChangeVerification({
    ...legacy,
    schemaVersion: 1,
    state: "proved",
    decision: "proved",
    runIds: ["run-1"],
    evidenceDigests: [digest],
  });

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.state, "needs-review");
  assert.equal(migrated.decision, "needs-review");
  assert.equal(migrated.planApproval, undefined);
  assert.equal(migrated.lastMutation.action, "legacy-v1-migration");
  assert.equal(migrated.lastMutation.version, migrated.version);
  assert.match(migrated.coverageGaps.at(-1)!, /predates durable Verification Plan approval/u);
  assert.equal(migrated.smallestNextVerification?.kind, "review");
});

test("approved v2 Proofs without cells migrate to review before execution or merge", () => {
  const value = fixture();
  const { cells: _cells, ...selection } = value.selection;
  const migrated = parseChangeVerification({ ...value, selection });

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.state, "needs-review");
  assert.equal(migrated.decision, "needs-review");
  assert.equal(migrated.planApproval, undefined);
  assert.equal(migrated.lastMutation.action, "legacy-plan-cell-migration");
  assert.equal(migrated.lastMutation.requestId, "legacy-plan-cell-migration");
  assert.match(migrated.coverageGaps.at(-1)!, /predates explicit Verification Cells/u);
  assert.equal(migrated.smallestNextVerification?.kind, "review");
});

test("a Proof can retain an unselected target without forcing Cartesian cells", () => {
  const value = fixture();
  const targetCase = value.selection.targetCases[0]!;
  const parsed = parseChangeVerification({
    ...value,
    selection: {
      ...value.selection,
      targetCases: [
        targetCase,
        {
          ...targetCase,
          id: "webkit-compact-ar",
          targetProfile: {
            ...targetCase.targetProfile,
            id: "web:compact:webkit:ar",
            browserCaseProfile: {
              ...targetCase.targetProfile.browserCaseProfile!,
              engine: "webkit",
            },
          },
        },
      ],
    },
  });
  assert.deepEqual(
    parsed.selection.cells?.map(({ id }) => id),
    ["cell-settings-chromium"],
  );
});

test("reviewed cells may repeat a journey and target for distinct frozen dimensions", () => {
  const value = fixture();
  const first = value.selection.cells![0]!;
  const parsed = parseChangeVerification({
    ...value,
    selection: {
      ...value.selection,
      cells: [
        first,
        {
          ...first,
          id: "cell-settings-chromium-light",
          requirement: "advisory",
          selectionReason: "Light theme is retained as reviewed advisory coverage.",
          dimensions: { ...first.dimensions, theme: "light" },
        },
      ],
    },
  });
  assert.equal(parsed.selection.cells?.length, 2);
  assert.throws(() =>
    parseChangeVerification({
      ...value,
      selection: {
        ...value.selection,
        cells: [first, { ...first, id: "duplicate-cell" }],
      },
    }),
  );
});

test("historical non-approved v2 planning records without cells remain readable", () => {
  const value = fixture({ state: "planning", planApproval: undefined });
  const { cells: _cells, ...selection } = value.selection;
  const parsed = parseChangeVerification({ ...value, selection });

  assert.equal(parsed.state, "planning");
  assert.equal(parsed.planApproval, undefined);
  assert.equal(parsed.selection.cells, undefined);
});

test("source metadata alone can never claim that a change is proved", () => {
  assert.throws(() =>
    parseChangeVerification(
      fixture({
        state: "proved",
        decision: "proved",
        builds: [],
        selection: { affectedJourneys: [], targetCases: [] },
        runIds: [],
        evidenceDigests: [],
      }),
    ),
  );
  assert.doesNotThrow(() =>
    parseChangeVerification(
      fixture({
        state: "proved",
        decision: "proved",
        runIds: ["run-1"],
        evidenceDigests: [digest],
      }),
    ),
  );
});

test("supersession is explicit and never turns an older head green", () => {
  assert.throws(() => parseChangeVerification(fixture({ state: "superseded" })));
  const superseded = fixture({
    version: 2,
    state: "superseded",
    supersededByProofId: "proof-2",
    lastMutation: {
      schemaVersion: 1,
      requestId: "request-2",
      requestDigest: digest,
      action: "rerun-affected",
      actorId: "agent:coder",
      proofId: "proof-1",
      previousVersion: 1,
      version: 2,
      at: 200,
    },
    updatedAt: 200,
  });
  assert.deepEqual(parseChangeVerification(superseded), superseded);
});

test("every lifecycle state has an unambiguous merge-decision projection", () => {
  for (const state of CHANGE_VERIFICATION_STATES) {
    const decision =
      state === "proved" ||
      state === "rejected" ||
      state === "needs-review" ||
      state === "insufficient-evidence"
        ? state
        : undefined;
    const proof = fixture({
      state,
      ...(decision ? { decision } : {}),
      ...(state === "proved" ? { runIds: ["run-1"], evidenceDigests: [digest] } : {}),
      ...(state === "superseded" ? { supersededByProofId: "proof-2" } : {}),
      ...(state === "cancelled"
        ? {
            cancellation: {
              reason: "Cancelled by the requester.",
              cancelledBy: "agent:coder",
              cancelledAt: 100,
            },
          }
        : {}),
    });
    assert.equal(parseChangeVerification(proof).state, state);
    assert.throws(() =>
      parseChangeVerification({
        ...proof,
        decision: decision === "proved" ? "rejected" : "proved",
      }),
    );
  }
});

test("the frozen execution target and full runtime profile are one identity", () => {
  const targetCase = fixture().selection.targetCases[0]!;
  assert.throws(() =>
    parseChangeVerification({
      ...fixture(),
      selection: {
        ...fixture().selection,
        targetCases: [
          {
            ...targetCase,
            executionTarget: { ...targetCase.executionTarget, targetId: "other" },
          },
        ],
      },
    }),
  );
  assert.throws(() =>
    parseChangeVerification({
      ...fixture(),
      selection: {
        ...fixture().selection,
        targetCases: [
          {
            ...targetCase,
            targetProfile: {
              ...targetCase.targetProfile,
              browserCaseProfile: {
                ...targetCase.targetProfile.browserCaseProfile!,
                viewport: { width: 1280, height: 800 },
              },
            },
          },
        ],
      },
    }),
  );
});
