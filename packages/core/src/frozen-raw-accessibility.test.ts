import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledRawAccessibilityTargetProfile,
  AppMapCompiledTest,
  RawAccessibilityTreeEvidence,
  StepTarget,
} from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(
  rawAccessibilityTreesByScreenId: NonNullable<
    AppMapCompiledTest["rawAccessibilityTreesByScreenId"]
  > = {},
): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok",
    appMapRevision: 1,
    test: { id: "relay-40", name: "Relay 40", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    rawAccessibilityTreesByScreenId,
    recipes: {
      root: {
        id: "root",
        title: "Root",
        parameters: [],
        steps: [
          {
            kind: "expect-screen",
            id: "profile",
            screenId: "profile",
            screenTitle: "Edit Profile",
            fingerprint: "profile",
          },
          {
            kind: "tap",
            id: "birth-year",
            target: {
              relation: {
                kind: "following-row",
                anchor: { identifier: "profile.birth-year", label: "Birth Year" },
              },
            },
          },
        ],
      },
    },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
}

function sourcePlan(
  rawAccessibilitySourcesByScreenId: NonNullable<
    AppMapCompiledTest["rawAccessibilitySourcesByScreenId"]
  >,
): AppMapCompiledTest {
  return {
    ...plan(),
    rawAccessibilitySourcesByScreenId,
  };
}

function rawTree(
  id: string,
  value: unknown,
): { reference: RawAccessibilityTreeEvidence; bytes: Buffer } {
  const bytes = Buffer.from(JSON.stringify(value));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    reference: {
      id,
      uri: `relay-evidence://${sha256}`,
      sha256,
      mime: "application/json",
      bytes: bytes.byteLength,
    },
    bytes,
  };
}

const reflowedBirthYearTree = {
  nodes: [
    {
      index: 0,
      type: "android.widget.ScrollView",
      rect: { x: 0, y: 120, width: 1080, height: 1920 },
    },
    {
      index: 10,
      parentIndex: 0,
      type: "android.widget.TextView",
      identifier: "profile.birth-year",
      label: "Ano de nascimento em duas linhas",
      enabled: true,
      visibleToUser: true,
      rect: { x: 72, y: 620, width: 620, height: 96 },
    },
    {
      index: 11,
      parentIndex: 0,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      rect: { x: 45, y: 748, width: 990, height: 136 },
    },
    {
      index: 12,
      parentIndex: 11,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      hittable: true,
      rect: { x: 45, y: 748, width: 990, height: 136 },
    },
    {
      index: 13,
      parentIndex: 12,
      type: "android.widget.TextView",
      label: "1994",
      enabled: true,
      visibleToUser: true,
      rect: { x: 192, y: 790, width: 90, height: 53 },
    },
  ],
};

function boundSource(
  tree: ReturnType<typeof rawTree>,
  variant: AppMapCompiledRawAccessibilitySource["variant"],
  capturedAt: number,
): AppMapCompiledRawAccessibilitySource {
  return {
    screenId: "profile",
    variant,
    origin: {
      kind: "screen-variant",
      observationId: `observation-${variant.id}`,
      capturedAt,
    },
    tree: tree.reference,
  };
}

function scopedSelectorPlan(input: {
  sources: AppMapCompiledRawAccessibilitySource[];
  variants: AppMapCompiledRawAccessibilitySource["variant"][];
  targetProfiles?: AppMapCompiledRawAccessibilityTargetProfile[];
  target: StepTarget;
}): AppMapCompiledTest {
  const compiled = sourcePlan({ profile: input.sources });
  compiled.rawAccessibilityVariantsByScreenId = { profile: structuredClone(input.variants) };
  if (input.targetProfiles) {
    compiled.rawAccessibilityTargetProfiles = structuredClone(input.targetProfiles);
  }
  compiled.recipes.root!.steps[1] = {
    kind: "tap",
    id: "scoped-selector",
    target: structuredClone(input.target),
  };
  return compiled;
}

const englishProfileVariant = {
  id: "profile-en",
  targetProfileId: "ipad-en-US",
  targetId: "ipad-1",
  platform: "ios" as const,
  viewport: { width: 834, height: 1112 },
};

const portugueseProfileVariant = {
  id: "profile-pt",
  targetProfileId: "ipad-pt-BR",
  targetId: "ipad-1",
  platform: "ios" as const,
  viewport: { width: 834, height: 1112 },
};

function buttonTree(input: { identifier?: string; label: string }) {
  return {
    nodes: [
      {
        index: 0,
        type: "Application",
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
      {
        index: 1,
        parentIndex: 0,
        type: "XCUIElementTypeButton",
        ...(input.identifier ? { identifier: input.identifier } : {}),
        label: input.label,
        enabled: true,
        visibleToUser: true,
        hittable: true,
        rect: { x: 42, y: 240, width: 750, height: 64 },
      },
    ],
  };
}

test("keeps the exact Android AVD identity on loaded raw selector evidence", async () => {
  const tree = rawTree(
    "medium-phone-prove",
    buttonTree({
      identifier: "dev.relay.prooffixture:id/prove_button",
      label: "Prove interaction",
    }),
  );
  const variant = {
    id: "medium-phone-ready",
    targetProfileId: "device:emulator-5554-1080x2400",
    targetId: "emulator-5554",
    platform: "android" as const,
    androidAvdName: "medium_phone",
    viewport: { width: 1080, height: 2400 },
  };
  const compiled = scopedSelectorPlan({
    sources: [boundSource(tree, variant, 10)],
    variants: [variant],
    targetProfiles: [
      {
        id: variant.targetProfileId,
        targetId: variant.targetId,
        platform: variant.platform,
        androidAvdName: variant.androidAvdName,
        viewport: variant.viewport,
      },
    ],
    target: { identifier: "dev.relay.prooffixture:id/prove_button" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === tree.reference.sha256 ? tree.bytes : null),
  });

  assert.equal(
    evidence.rawSourcesByScreenId?.profile?.[0]?.source.variant?.androidAvdName,
    "medium_phone",
  );
  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: variant.targetProfileId,
  });
  assert.equal(report.selectors[0]?.status, "resolved");
  assert.deepEqual(report.findings, []);
});

test("loads a translated/reflowed raw tree with immutable source provenance", async () => {
  const tree = rawTree("profile-pt-tree", reflowedBirthYearTree);
  const source: AppMapCompiledRawAccessibilitySource = {
    screenId: "profile",
    variant: {
      id: "profile-pt",
      targetProfileId: "ipad-pt-BR",
      targetId: "ipad-1",
      platform: "ios",
      viewport: { width: 834, height: 1112 },
    },
    origin: {
      kind: "screen-variant",
      observationId: "observation-profile-pt",
      capturedAt: 10,
    },
    tree: tree.reference,
  };
  const compiled = sourcePlan({ profile: [source] });

  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === tree.reference.sha256 ? tree.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.deepEqual(report.findings, []);
  assert.equal(selector.status, "resolved");
  assert.deepEqual(selector.resolution, {
    method: "relation",
    activation: "snapshot-point",
    snapshotBounds: { x: 45, y: 748, width: 990, height: 136 },
    provenance: {
      reference: tree.reference.uri,
      evidenceId: "profile-pt-tree",
      sha256: tree.reference.sha256,
      variant: source.variant,
      origin: source.origin,
    },
  });
  assert.deepEqual(selector.evidence.sources, [selector.resolution?.provenance]);
  assert.deepEqual(
    selector.rawCandidates?.map((candidate) => [
      candidate.relation,
      candidate.node.index,
      candidate.node.parentIndex,
      candidate.node.bounds,
      candidate.node.hittable,
      candidate.owner?.index,
    ]),
    [
      ["relation-anchor", 10, 0, { x: 72, y: 620, width: 620, height: 96 }, undefined, undefined],
      ["following-row", 12, 11, { x: 45, y: 748, width: 990, height: 136 }, true, 12],
    ],
  );
});

test("does not let an English raw label bless the selected Portuguese Variant", async () => {
  const english = rawTree("profile-en-voice", buttonTree({ label: "Voice" }));
  const portuguese = rawTree("profile-pt-voice", buttonTree({ label: "Voz" }));
  const englishSource = boundSource(english, englishProfileVariant, 10);
  const portugueseSource = boundSource(portuguese, portugueseProfileVariant, 11);
  const compiled = scopedSelectorPlan({
    sources: [englishSource, portugueseSource],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) =>
      sha256 === english.reference.sha256
        ? english.bytes
        : sha256 === portuguese.reference.sha256
          ? portuguese.bytes
          : null,
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;

  assert.equal(selector.status, "variant-incompatible");
  assert.equal(selector.resolution, undefined);
  assert.deepEqual(selector.rawVariantScope, {
    selectedTargetProfileId: "ipad-pt-BR",
    selectedVariant: portugueseProfileVariant,
    candidates: [
      {
        variant: englishProfileVariant,
        sourceCount: 1,
        compatibility: "incompatible",
        reason: "locale-sensitive-selector",
      },
      {
        variant: portugueseProfileVariant,
        sourceCount: 1,
        compatibility: "selected-variant",
        reason: "selected-runtime-variant",
      },
    ],
  });
  assert.equal(report.findings[0]?.code, "raw-evidence-variant-recapture-required");
  assert.match(report.findings[0]?.message ?? "", /profile-pt/u);
  assert.match(selector.detail ?? "", /incompatible raw Variant/u);
});

test("requires a profile choice when a known locale Variant still lacks raw evidence", async () => {
  const english = rawTree("profile-en-only-voice", buttonTree({ label: "Voice" }));
  const englishSource = boundSource(english, englishProfileVariant, 10);
  const compiled = scopedSelectorPlan({
    sources: [englishSource],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.equal(selector.status, "variant-selection-required");
  assert.equal(selector.resolution, undefined);
  assert.deepEqual(selector.rawVariantScope?.candidates, [
    {
      variant: englishProfileVariant,
      sourceCount: 1,
      compatibility: "incompatible",
      reason: "locale-sensitive-selector",
    },
    {
      variant: portugueseProfileVariant,
      sourceCount: 0,
      compatibility: "incompatible",
      reason: "no-raw-source",
    },
  ]);
  assert.equal(report.findings[0]?.code, "raw-evidence-variant-selection-required");
});

test("keeps authored raw proof selected after a localized run promotes a same-profile Variant", async () => {
  const authored = rawTree(
    "authored-voice",
    buttonTree({ identifier: "settings.voice", label: "Voice" }),
  );
  const promoted = rawTree("promoted-voice-ko", buttonTree({ label: "음성" }));
  const localizedVariant = {
    ...englishProfileVariant,
    id: "run-ko-voice",
    captureProvenanceKind: "run" as const,
  };
  const compiled = scopedSelectorPlan({
    sources: [
      boundSource(authored, englishProfileVariant, 10),
      boundSource(promoted, localizedVariant, 20),
    ],
    variants: [englishProfileVariant, localizedVariant],
    targetProfiles: [
      {
        id: englishProfileVariant.targetProfileId,
        targetId: englishProfileVariant.targetId,
        platform: englishProfileVariant.platform,
        viewport: englishProfileVariant.viewport,
      },
    ],
    target: { identifier: "settings.voice", role: "XCUIElementTypeButton" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) =>
      sha256 === authored.reference.sha256
        ? authored.bytes
        : sha256 === promoted.reference.sha256
          ? promoted.bytes
          : null,
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: englishProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;
  assert.equal(selector.status, "resolved");
  assert.equal(selector.resolution?.provenance?.variant?.id, englishProfileVariant.id);
  assert.equal(report.findings.length, 0);
});

test("uses the compiled Test-wide profile ledger when this screen only has English evidence", async () => {
  const english = rawTree("profile-global-en-only-voice", buttonTree({ label: "Voice" }));
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant],
    targetProfiles: [
      {
        id: englishProfileVariant.targetProfileId,
        targetId: englishProfileVariant.targetId,
        platform: englishProfileVariant.platform,
        viewport: englishProfileVariant.viewport,
      },
      {
        id: portugueseProfileVariant.targetProfileId,
        targetId: portugueseProfileVariant.targetId,
        platform: portugueseProfileVariant.platform,
        viewport: portugueseProfileVariant.viewport,
      },
    ],
    target: { label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const unselected = preflightCompiledAppMapTestOffline(compiled, evidence);
  assert.equal(unselected.selectors[0]?.status, "variant-selection-required");
  assert.deepEqual(
    unselected.selectors[0]?.rawVariantScope?.targetProfileCandidates?.map((profile) => profile.id),
    ["ipad-en-US", "ipad-pt-BR"],
  );
  assert.equal(unselected.findings[0]?.code, "raw-evidence-variant-selection-required");

  const selectedPortuguese = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  assert.equal(selectedPortuguese.selectors[0]?.status, "variant-incompatible");
  assert.equal(selectedPortuguese.selectors[0]?.rawVariantScope?.selectedVariant, undefined);
  assert.deepEqual(selectedPortuguese.selectors[0]?.rawVariantScope?.selectedTargetProfile, {
    id: "ipad-pt-BR",
    targetId: "ipad-1",
    platform: "ios",
    viewport: { width: 834, height: 1112 },
  });
  assert.equal(selectedPortuguese.findings[0]?.code, "raw-evidence-variant-recapture-required");
  assert.match(selectedPortuguese.findings[0]?.message ?? "", /ipad-pt-BR/u);
});

test("prioritizes a global profile choice over a generic unavailable-tree repair", async () => {
  const english = rawTree("profile-global-unavailable", buttonTree({ label: "Voice" }));
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant],
    targetProfiles: [
      {
        id: englishProfileVariant.targetProfileId,
        targetId: englishProfileVariant.targetId,
        platform: englishProfileVariant.platform,
        viewport: englishProfileVariant.viewport,
      },
      {
        id: portugueseProfileVariant.targetProfileId,
        targetId: portugueseProfileVariant.targetId,
        platform: portugueseProfileVariant.platform,
        viewport: portugueseProfileVariant.viewport,
      },
    ],
    target: { label: "Voice" },
  });
  const report = preflightCompiledAppMapTestOffline(
    compiled,
    await loadFrozenRawAccessibilityEvidence(compiled, { readEvidence: async () => null }),
  );

  assert.equal(report.selectors[0]?.status, "variant-selection-required");
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["raw-evidence-variant-selection-required"],
  );
});

test("keeps an expect-screen-only raw repair when no selector can name the profile scope", async () => {
  const compiled = sourcePlan({ profile: [] });
  compiled.rawAccessibilityVariantsByScreenId = {
    profile: [englishProfileVariant, portugueseProfileVariant],
  };
  compiled.rawAccessibilityTargetProfiles = [
    {
      id: englishProfileVariant.targetProfileId,
      targetId: englishProfileVariant.targetId,
      platform: englishProfileVariant.platform,
      viewport: englishProfileVariant.viewport,
    },
    {
      id: portugueseProfileVariant.targetProfileId,
      targetId: portugueseProfileVariant.targetId,
      platform: portugueseProfileVariant.platform,
      viewport: portugueseProfileVariant.viewport,
    },
  ];
  compiled.recipes.root!.steps = [compiled.recipes.root!.steps[0]!];

  const report = preflightCompiledAppMapTestOffline(
    compiled,
    await loadFrozenRawAccessibilityEvidence(compiled),
  );

  assert.equal(report.selectors.length, 0);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["raw-evidence-recapture-required"],
  );
  assert.equal(report.summary.blockers, 1);
});

test("requires a profile choice before requesting a raw capture for two known Variants", async () => {
  const compiled = scopedSelectorPlan({
    sources: [],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async () => null,
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.equal(selector.status, "variant-selection-required");
  assert.equal(selector.resolution, undefined);
  assert.deepEqual(selector.rawVariantScope?.candidates, [
    {
      variant: englishProfileVariant,
      sourceCount: 0,
      compatibility: "incompatible",
      reason: "no-raw-source",
    },
    {
      variant: portugueseProfileVariant,
      sourceCount: 0,
      compatibility: "incompatible",
      reason: "no-raw-source",
    },
  ]);
  assert.ok(
    report.findings.some((finding) => finding.code === "raw-evidence-variant-selection-required"),
  );
});

test("names the selected Variant when that profile has no raw tree to prove", async () => {
  const compiled = scopedSelectorPlan({
    sources: [],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async () => null,
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;

  assert.equal(selector.status, "raw-evidence-unavailable");
  assert.deepEqual(selector.rawVariantScope?.selectedVariant, portugueseProfileVariant);
  assert.match(selector.detail ?? "", /profile-pt/u);
  assert.match(report.findings[0]?.message ?? "", /profile-pt/u);
});

test("reuses an explicit identifier across equal-viewport locale Variants", async () => {
  const english = rawTree(
    "profile-en-voice-identifier",
    buttonTree({
      identifier: "settings.voice",
      label: "Voice",
    }),
  );
  const englishSource = boundSource(english, englishProfileVariant, 10);
  const compiled = scopedSelectorPlan({
    sources: [englishSource],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;

  assert.deepEqual(report.findings, []);
  assert.equal(selector.status, "resolved");
  assert.equal(selector.resolution?.method, "identifier");
  assert.deepEqual(selector.resolution?.provenance?.variant, englishProfileVariant);
  assert.deepEqual(selector.rawVariantScope?.candidates, [
    {
      variant: englishProfileVariant,
      sourceCount: 1,
      compatibility: "stable-identifier-equivalent",
      reason: "same-target-platform-and-viewport",
    },
    {
      variant: portugueseProfileVariant,
      sourceCount: 0,
      compatibility: "selected-variant",
      reason: "no-raw-source",
    },
  ]);
});

test("does not reuse an identifier across a different runtime viewport", async () => {
  const portugueseAtOtherViewport = {
    ...portugueseProfileVariant,
    viewport: { width: 820, height: 1112 },
  };
  const english = rawTree(
    "profile-en-voice-different-viewport",
    buttonTree({ identifier: "settings.voice", label: "Voice" }),
  );
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant, portugueseAtOtherViewport],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseAtOtherViewport.targetProfileId,
  });

  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(
    report.selectors[0]?.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishProfileVariant.id,
    )?.reason,
    "target-platform-or-viewport-mismatch",
  );
});

test("does not reuse a browser identifier across a different non-locale environment", async () => {
  const viewport = { width: 390, height: 844 };
  const englishBrowser = {
    id: "profile-browser-en",
    targetProfileId: "browser-en-US",
    targetId: "browser-1",
    platform: "browser" as const,
    viewport,
    browserCaseProfile: compileBrowserEnvironment({
      viewport,
      locale: "en-US",
      networkProfile: "wifi",
    }),
  };
  const portugueseBrowser = {
    id: "profile-browser-pt",
    targetProfileId: "browser-pt-BR",
    targetId: "browser-1",
    platform: "browser" as const,
    viewport,
    browserCaseProfile: compileBrowserEnvironment({
      viewport,
      locale: "pt-BR",
      networkProfile: "offline-fixture",
    }),
  };
  const english = rawTree(
    "profile-browser-en-identifier",
    buttonTree({ identifier: "settings.voice", label: "Voice" }),
  );
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishBrowser, 10)],
    variants: [englishBrowser, portugueseBrowser],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseBrowser.targetProfileId,
  });
  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(
    report.selectors[0]?.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishBrowser.id,
    )?.reason,
    "target-platform-or-viewport-mismatch",
  );
});

test("does not reuse a browser identifier across a different locale", async () => {
  const viewport = { width: 390, height: 844 };
  const englishBrowser = {
    id: "profile-browser-en-locale",
    targetProfileId: "browser-en-US-locale",
    targetId: "browser-1",
    platform: "browser" as const,
    viewport,
    browserCaseProfile: compileBrowserEnvironment({ viewport, locale: "en-US" }),
  };
  const portugueseBrowser = {
    id: "profile-browser-pt-locale",
    targetProfileId: "browser-pt-BR-locale",
    targetId: "browser-1",
    platform: "browser" as const,
    viewport,
    browserCaseProfile: compileBrowserEnvironment({ viewport, locale: "pt-BR" }),
  };
  const english = rawTree(
    "profile-browser-en-locale-identifier",
    buttonTree({ identifier: "settings.voice", label: "Voice" }),
  );
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishBrowser, 10)],
    variants: [englishBrowser, portugueseBrowser],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseBrowser.targetProfileId,
  });
  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(
    report.selectors[0]?.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishBrowser.id,
    )?.reason,
    "target-platform-or-viewport-mismatch",
  );
});

test("rejects conflicting viewport identities that reuse one profile ID", async () => {
  const conflictingEnglish = {
    ...englishProfileVariant,
    viewport: { width: 820, height: 1112 },
  };
  const english = rawTree(
    "profile-en-conflicting-viewport",
    buttonTree({ identifier: "settings.voice", label: "Voice" }),
  );
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant, conflictingEnglish],
    targetProfiles: [
      {
        id: englishProfileVariant.targetProfileId,
        targetId: englishProfileVariant.targetId,
        platform: englishProfileVariant.platform,
        viewport: englishProfileVariant.viewport,
      },
      {
        id: conflictingEnglish.targetProfileId,
        targetId: conflictingEnglish.targetId,
        platform: conflictingEnglish.platform,
        viewport: conflictingEnglish.viewport,
      },
    ],
    target: { identifier: "settings.voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: englishProfileVariant.targetProfileId,
  });
  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(report.selectors[0]?.resolution, undefined);
  assert.equal(report.findings[0]?.code, "raw-evidence-variant-recapture-required");
  assert.match(report.selectors[0]?.detail ?? "", /one frozen target identity/u);
});

test("does not turn a failed cross-locale identifier into a label fallback", async () => {
  const english = rawTree("profile-en-identifier-fallback", {
    nodes: [
      {
        index: 0,
        type: "Application",
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
      {
        index: 1,
        parentIndex: 0,
        type: "XCUIElementTypeButton",
        identifier: "settings.voice",
        label: "Voice",
        enabled: true,
        visibleToUser: true,
        hittable: true,
        // The stable identifier is outside this frozen viewport.
        rect: { x: 42, y: 1220, width: 750, height: 64 },
      },
      {
        index: 2,
        parentIndex: 0,
        type: "XCUIElementTypeButton",
        label: "Voice",
        enabled: true,
        visibleToUser: true,
        hittable: true,
        rect: { x: 42, y: 240, width: 750, height: 64 },
      },
    ],
  });
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });

  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(report.selectors[0]?.resolution, undefined);
  assert.equal(
    report.selectors[0]?.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishProfileVariant.id,
    )?.reason,
    "stable-selector-not-activatable",
  );
  assert.match(report.selectors[0]?.detail ?? "", /incompatible raw Variant/u);
});

test("requires the selected Variant to publish its own stable selector when it has raw evidence", async () => {
  const english = rawTree(
    "profile-en-stable-voice",
    buttonTree({
      identifier: "settings.voice",
      label: "Voice",
    }),
  );
  const portuguese = rawTree("profile-pt-unstable-voice", buttonTree({ label: "Voz" }));
  const compiled = scopedSelectorPlan({
    sources: [
      boundSource(english, englishProfileVariant, 10),
      boundSource(portuguese, portugueseProfileVariant, 11),
    ],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: { identifier: "settings.voice", label: "Voice" },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) =>
      sha256 === english.reference.sha256
        ? english.bytes
        : sha256 === portuguese.reference.sha256
          ? portuguese.bytes
          : null,
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;

  assert.equal(selector.status, "variant-incompatible");
  assert.equal(selector.resolution, undefined);
  assert.equal(
    selector.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishProfileVariant.id,
    )?.reason,
    "selected-variant-needs-own-proof",
  );
});

test("reuses a following-row proof only when its anchor publishes an explicit identifier", async () => {
  const english = rawTree("profile-en-birth-year", reflowedBirthYearTree);
  const englishSource = boundSource(english, englishProfileVariant, 10);
  const compiled = scopedSelectorPlan({
    sources: [englishSource],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: {
      relation: {
        kind: "following-row",
        anchor: {
          identifier: "profile.birth-year",
          // Deliberately translated differently from the source tree: the
          // stable identifier, not this label, licenses cross-locale reuse.
          label: "Ano de nascimento",
        },
      },
    },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });
  const selector = report.selectors[0]!;

  assert.deepEqual(report.findings, []);
  assert.equal(selector.status, "resolved");
  assert.equal(selector.resolution?.method, "relation");
  assert.deepEqual(selector.rawVariantScope?.candidates[0], {
    variant: englishProfileVariant,
    sourceCount: 1,
    compatibility: "stable-relation-equivalent",
    reason: "same-target-platform-and-viewport",
  });
});

test("does not let a cross-locale relation fall back from its identifier to a label", async () => {
  const english = rawTree("profile-en-relation-label-fallback", {
    nodes: [
      {
        index: 0,
        type: "Application",
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
      {
        // This preserves the stable identifier in the frozen tree, but it is
        // not a usable relation anchor. Ordinary resolution could otherwise
        // use the visible label-only copy below.
        index: 1,
        parentIndex: 0,
        type: "XCUIElementTypeStaticText",
        identifier: "profile.birth-year",
        label: "Birth Year",
        enabled: true,
        visibleToUser: false,
        rect: { x: 42, y: 120, width: 750, height: 44 },
      },
      {
        index: 2,
        parentIndex: 0,
        type: "XCUIElementTypeStaticText",
        label: "Birth Year",
        enabled: true,
        visibleToUser: true,
        rect: { x: 42, y: 240, width: 750, height: 44 },
      },
      {
        index: 3,
        parentIndex: 0,
        type: "XCUIElementTypeButton",
        label: "1994",
        enabled: true,
        visibleToUser: true,
        hittable: true,
        rect: { x: 42, y: 304, width: 750, height: 64 },
      },
    ],
  });
  const compiled = scopedSelectorPlan({
    sources: [boundSource(english, englishProfileVariant, 10)],
    variants: [englishProfileVariant, portugueseProfileVariant],
    target: {
      relation: {
        kind: "following-row",
        anchor: { identifier: "profile.birth-year", label: "Birth Year" },
      },
    },
  });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === english.reference.sha256 ? english.bytes : null),
  });

  const report = preflightCompiledAppMapTestOffline(compiled, evidence, {
    targetProfileId: portugueseProfileVariant.targetProfileId,
  });

  assert.equal(report.selectors[0]?.status, "variant-incompatible");
  assert.equal(report.selectors[0]?.resolution, undefined);
  assert.equal(
    report.selectors[0]?.rawVariantScope?.candidates.find(
      (candidate) => candidate.variant.id === englishProfileVariant.id,
    )?.reason,
    "stable-selector-not-activatable",
  );
});

test("rejects a partially corrupted frozen source set instead of using the surviving tree", async () => {
  const valid = rawTree("profile-valid-tree", reflowedBirthYearTree);
  const corrupt = rawTree("profile-corrupt-tree", { nodes: [{ label: "not this tree" }] });
  const compiled = plan({ profile: [valid.reference, corrupt.reference] });

  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) =>
      sha256 === valid.reference.sha256
        ? valid.bytes
        : sha256 === corrupt.reference.sha256
          ? Buffer.from('{"not":"a snapshot"}')
          : null,
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unreadable");
  assert.equal(selector.status, "raw-evidence-unavailable");
  assert.equal(report.summary.blockers, 1);
  assert.deepEqual(report.findings, [
    {
      severity: "blocker",
      code: "raw-evidence-recapture-required",
      recipeId: "root",
      recipeStepId: "birth-year",
      screenId: "profile",
      message:
        "Edit Profile's frozen raw accessibility tree is unavailable or corrupt; recapture this screen before relying on offline geometry.",
      evidence: [
        {
          reference: valid.reference.uri,
          evidenceId: valid.reference.id,
          sha256: valid.reference.sha256,
        },
        {
          reference: corrupt.reference.uri,
          evidenceId: corrupt.reference.id,
          sha256: corrupt.reference.sha256,
        },
      ],
    },
  ]);
});

test("turns a frozen evidence read error into a compact recapture blocker", async () => {
  const tree = rawTree("profile-unavailable-tree", reflowedBirthYearTree);
  const compiled = plan({ profile: [tree.reference] });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async () => {
      throw new Error("evidence storage unavailable");
    },
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unreadable");
  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["raw-evidence-recapture-required"],
  );
  assert.deepEqual(report.findings[0]?.evidence, [
    {
      reference: tree.reference.uri,
      evidenceId: tree.reference.id,
      sha256: tree.reference.sha256,
    },
  ]);
});

test("treats a valid legacy raw reference as one observation-binding recapture", async () => {
  const tree = rawTree("profile-legacy-tree", reflowedBirthYearTree);
  const compiled = plan({ profile: [tree.reference] });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === tree.reference.sha256 ? tree.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unbound");
  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(report.findings, [
    {
      severity: "blocker",
      code: "raw-evidence-recapture-required",
      recipeId: "root",
      recipeStepId: "birth-year",
      screenId: "profile",
      message:
        "Edit Profile's frozen raw accessibility tree is not bound to its current observation; recapture this screen before relying on offline geometry.",
      evidence: [
        {
          reference: tree.reference.uri,
          evidenceId: tree.reference.id,
          sha256: tree.reference.sha256,
        },
      ],
    },
  ]);
});

test("marks a declared-but-empty raw source as one missing recapture blocker", async () => {
  const compiled = plan({ profile: [] });
  const report = preflightCompiledAppMapTestOffline(
    compiled,
    await loadFrozenRawAccessibilityEvidence(compiled, { readEvidence: async () => null }),
  );

  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(
    report.findings.map((finding) => [finding.severity, finding.code]),
    [["blocker", "raw-evidence-recapture-required"]],
  );
});
