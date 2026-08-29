import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChangeSignals,
  JourneyAssociation,
  VerificationPlanTargetCase,
} from "@relay/protocol";
import {
  compileVerificationPlan,
  computeChangeImpact,
  proofStartInputFromVerificationPlan,
} from "./change-impact.js";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const change = { repository: "acme/settings", baseSha, headSha, pullRequest: 184 };

function signals(overrides: Partial<ChangeSignals> = {}): ChangeSignals {
  return {
    files: [],
    symbols: [],
    routes: [],
    resources: [],
    localizationKeys: [],
    apiContracts: [],
    ...overrides,
  };
}

function association(
  id: string,
  testId: string,
  associatedSignals: ChangeSignals,
  overrides: Partial<JourneyAssociation> = {},
): JourneyAssociation {
  return {
    id,
    appMapId: "settings",
    testId,
    signals: associatedSignals,
    confidence: "definite",
    reason: `Reviewed source coverage for ${testId}.`,
    review: {
      status: "reviewed",
      revision: 1,
      reviewedBy: "human:reviewer",
      reviewedAt: 100,
    },
    ...overrides,
  };
}

function browserCase(id: string, width: number): VerificationPlanTargetCase {
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
      viewport: { width, height: 844 },
      browserCaseProfile: {
        schemaVersion: 1,
        engine: "chromium",
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
        mobile: width < 768,
        touch: width < 768,
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
    dimensions: { locale: "ar", viewport: width < 768 ? "compact" : "expanded" },
    required: true,
  };
}

test("reviewed Settings, auth, and visual associations select explained journeys", () => {
  const impact = computeChangeImpact({
    change,
    changed: signals({
      files: ["src/settings/LanguagePanel.tsx"],
      localizationKeys: ["settings.language.title"],
      apiContracts: ["POST /session/refresh"],
      resources: ["design-token:action-spacing"],
    }),
    associations: [
      association(
        "settings-copy",
        "settings-language",
        signals({ files: ["src/settings"], localizationKeys: ["settings.language.title"] }),
      ),
      association(
        "auth-session",
        "session-restoration",
        signals({ apiContracts: ["POST /session/refresh"] }),
      ),
      association(
        "settings-layout",
        "settings-responsive-layout",
        signals({ resources: ["design-token:action-spacing"] }),
        { confidence: "probable" },
      ),
      association("unrelated", "account-deletion", signals({ routes: ["/account/delete"] })),
    ],
  });

  assert.deepEqual(
    impact.journeys.map(({ testId, classification }) => ({ testId, classification })),
    [
      { testId: "account-deletion", classification: "unrelated" },
      { testId: "session-restoration", classification: "definitely-affected" },
      { testId: "settings-language", classification: "definitely-affected" },
      { testId: "settings-responsive-layout", classification: "probably-affected" },
    ],
  );
  assert.equal(impact.coverageGaps.length, 0);
  assert.match(
    impact.journeys.find(({ testId }) => testId === "settings-language")!.reason,
    /Reviewed source coverage/u,
  );
});

test("unknown and merely proposed impact becomes an explicit coverage gap", () => {
  const impact = computeChangeImpact({
    change,
    changed: signals({
      files: ["src/shared/unknown.ts"],
      symbols: ["refreshUnknownSession"],
    }),
    associations: [
      association("proposal", "shared-flow", signals({ symbols: ["refreshUnknownSession"] }), {
        review: { status: "proposed", revision: 1 },
      }),
    ],
  });

  assert.deepEqual(
    impact.coverageGaps.map(({ code }) => code),
    ["unmapped-change", "unreviewed-association"],
  );
  assert.equal(impact.journeys.length, 0);
});

test("Verification Plans freeze exact builds, deterministic pilot, and bounded expansion", () => {
  const input = {
    change,
    changed: signals({ localizationKeys: ["settings.language.title"] }),
    associations: [
      association(
        "settings-copy",
        "settings-language",
        signals({ localizationKeys: ["settings.language.title"] }),
      ),
    ],
    builds: [
      {
        id: "web",
        platform: "web",
        artifactDigest: digest,
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "deploy-184",
      },
    ],
    targetCases: [browserCase("webkit-compact", 390), browserCase("chromium-expanded", 1280)],
    policy: { id: "relay.default", version: 3 },
  } as const;
  const first = compileVerificationPlan(input);
  const second = compileVerificationPlan({
    ...input,
    targetCases: [...input.targetCases].reverse(),
  });

  assert.equal(first.status, "ready-for-approval");
  assert.equal(first.pilotTargetCaseId, "chromium-expanded");
  assert.deepEqual(first.expansion.targetCaseIds, ["webkit-compact"]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.selection.affectedJourneys, [
    {
      appMapId: "settings",
      testId: "settings-language",
      reason: "Reviewed source coverage for settings-language.",
      confidence: "definite",
    },
  ]);
  const proofInput = proofStartInputFromVerificationPlan(first);
  assert.equal(proofInput.smallestNextVerification?.kind, "approve-plan");
  assert.deepEqual(proofInput.coverageGaps, []);
});

test("mismatched builds fail closed and missing builds or required cases cannot be ready", () => {
  const base = {
    change,
    changed: signals({ routes: ["/settings/language"] }),
    associations: [
      association(
        "settings-route",
        "settings-language",
        signals({ routes: ["/settings/language"] }),
      ),
    ],
    targetCases: [browserCase("compact", 390)],
    policy: { id: "relay.default", version: 3 },
  };
  assert.throws(() =>
    compileVerificationPlan({
      ...base,
      builds: [
        {
          id: "web",
          platform: "web",
          artifactDigest: digest,
          sourceSha: baseSha,
          configuration: "production",
          environmentRevision: "stale",
        },
      ],
    }),
  );
  assert.equal(compileVerificationPlan({ ...base, builds: [] }).status, "awaiting-build");
  assert.equal(
    compileVerificationPlan({
      ...base,
      builds: [
        {
          id: "web",
          platform: "web",
          artifactDigest: digest,
          sourceSha: headSha,
          configuration: "production",
          environmentRevision: "deploy-184",
        },
      ],
      targetCases: [],
    }).status,
    "needs-review",
  );
});

test("case budgets count explicit journey and target cells", () => {
  const plan = compileVerificationPlan({
    change,
    changed: signals({ localizationKeys: ["settings.language.title"] }),
    associations: [
      association(
        "settings-language-copy",
        "settings-language",
        signals({ localizationKeys: ["settings.language.title"] }),
      ),
      association(
        "settings-language-help",
        "settings-language-help",
        signals({ localizationKeys: ["settings.language.title"] }),
      ),
    ],
    builds: [
      {
        id: "web",
        platform: "web",
        artifactDigest: digest,
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "deploy-184",
      },
    ],
    targetCases: [browserCase("compact", 390)],
    policy: { id: "relay.default", version: 3 },
    maxCases: 1,
  });

  assert.equal(plan.selection.cells?.length, 2);
  assert.equal(plan.expansion.maxCases, 1);
  assert.equal(plan.status, "needs-review");
  assert.ok(plan.coverageGaps.some(({ code }) => code === "required-case-budget-exceeded"));
});
