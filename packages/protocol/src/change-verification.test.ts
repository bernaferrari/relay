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
    schemaVersion: 1,
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
    },
    policy: { id: "relay.default", version: 3 },
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: { kind: "run-pilot", reason: "Run the representative case." },
    requestedBy: "agent:coder",
    updatedBy: "agent:coder",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("Change Verification freezes one exact change, build, plan, and policy", () => {
  assert.deepEqual(parseChangeVerification(fixture()), fixture());
  assert.throws(() =>
    parseChangeVerification({
      ...fixture(),
      builds: [{ ...fixture().builds[0]!, sourceSha: baseSha }],
    }),
  );
  assert.throws(() => parseChangeVerification({ ...fixture(), extra: true }));
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
