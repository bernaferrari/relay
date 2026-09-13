import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapMutationContext,
  AuthoringEvidence,
  AuthoringObservation,
  TargetProfile,
} from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { observeScreenIdentity } from "../screen-identity.js";
import { observeAppMapScreenAlias } from "./screen-operations.js";

const primaryFingerprint = "a".repeat(64);
const localeNodes = [{ role: "button", label: "Continuar", enabled: true }];
const localeFingerprint = observeScreenIdentity(localeNodes).fingerprint;

function mapFixture(options: { aliases?: string[]; fingerprint?: string } = {}): AppMap {
  const { aliases = [], fingerprint = primaryFingerprint } = options;
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Store",
    revision: 0,
    notes: {},
    groups: {},
    screens: {
      settings: {
        organizationId: "org-1",
        projectId: "project-1",
        appMapId: "map-1",
        id: "settings",
        title: "Settings",
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
        ...(fingerprint
          ? {
              identity: {
                schemaVersion: 1 as const,
                fingerprint,
                ...(aliases.length ? { aliases } : {}),
              },
            }
          : {}),
      },
    },
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function observation(
  nodes: Array<Record<string, unknown>>,
  proof?: AuthoringObservation["proof"],
): AuthoringObservation {
  return {
    id: "observe-1",
    capturedAt: 2,
    screen: { id: "observed", fingerprint: "b".repeat(64), capturedAt: 2, source: "recording" },
    evidenceIds: [],
    ...(proof ? { proof } : {}),
    nodes,
  };
}

function context(eventId: string, revision = 0, at = 10): AppMapMutationContext {
  return {
    expectedRevision: revision,
    eventId,
    actorId: "person-1",
    actorKind: "human",
    at,
  };
}

test("alias-observe appends the observed fingerprint without touching the primary", () => {
  const result = observeAppMapScreenAlias(
    mapFixture(),
    "settings",
    observation(localeNodes),
    context("alias-observe-1"),
  );

  const identity = result.appMap.screens.settings?.identity;
  assert.ok(identity, "screen keeps its identity");
  assert.equal(identity.fingerprint, primaryFingerprint, "primary fingerprint is never replaced");
  assert.deepEqual(identity.aliases, [localeFingerprint]);
  assert.deepEqual(result.alias, {
    fingerprint: localeFingerprint,
    aliasesNow: [localeFingerprint],
  });
  assert.equal(result.appMap.revision, 1);
});

test("alias-observe persists a target-specific variant and immutable evidence", () => {
  const screenshotSha = "c".repeat(64);
  const snapshotSha = "d".repeat(64);
  const screenshot: AuthoringEvidence = {
    id: "locale-screenshot",
    kind: "screenshot",
    capturedAt: 2,
    uri: `relay-evidence://${screenshotSha}`,
    mime: "image/png",
    bytes: 128,
    sha256: screenshotSha,
  };
  const snapshot: AuthoringEvidence = {
    id: "locale-snapshot",
    kind: "snapshot",
    capturedAt: 2,
    uri: `relay-evidence://${snapshotSha}`,
    mime: "application/json",
    bytes: 256,
    sha256: snapshotSha,
  };
  const profile: TargetProfile = {
    id: "browser:settings:390x844",
    targetId: "managed-settings",
    source: "browser",
    platform: "browser",
    name: "Managed Chromium settings",
    viewport: { width: 390, height: 844 },
    browserCaseProfile: compileBrowserEnvironment({
      viewport: { width: 390, height: 844 },
    }),
    capabilities: ["snapshot", "screenshot"],
    observedAt: 2,
  };
  const observed = observation(localeNodes);
  observed.id = "locale-observation";
  observed.screen.fingerprint = localeFingerprint;
  observed.evidenceIds = [screenshot.id, snapshot.id];
  observed.bounds = { width: 390, height: 844 };
  const result = observeAppMapScreenAlias(
    mapFixture(),
    "settings",
    observed,
    context("alias-browser", 0, 2),
    {
      target: { kind: "browser", platform: "browser", targetId: profile.targetId },
      targetProfile: profile,
      evidenceUrisById: {
        [screenshot.id]: screenshot.uri,
        [snapshot.id]: snapshot.uri,
      },
      evidenceKindsById: {
        [screenshot.id]: screenshot.kind,
        [snapshot.id]: snapshot.kind,
      },
      evidenceById: { [screenshot.id]: screenshot, [snapshot.id]: snapshot },
    },
  );

  assert.ok(result.variant, "alias approval returns the persisted variant");
  const variant = result.appMap.screenVariants[result.variant!.id]!;
  assert.equal(variant.screenId, "settings");
  assert.equal(variant.targetProfile.id, profile.id);
  assert.deepEqual(variant.targetProfile.viewport, profile.viewport);
  assert.deepEqual(variant.evidenceIds, [screenshot.id, snapshot.id]);
  assert.equal(variant.screenshotUri, screenshot.uri);
  assert.deepEqual(variant.rawAccessibilityTree, {
    id: snapshot.id,
    uri: snapshot.uri,
    sha256: snapshotSha,
    mime: "application/json",
    bytes: snapshot.bytes,
    observationId: observed.id,
    capturedAt: snapshot.capturedAt,
  });
  assert.deepEqual(result.appMap.screens.settings?.variantIds, [variant.id]);
  assert.equal(result.appMap.screens.settings?.identity?.fingerprint, primaryFingerprint);
  assert.deepEqual(result.appMap.screens.settings?.identity?.aliases, [localeFingerprint]);
});

test("alias-observe deduplicates repeated and pre-existing aliases", () => {
  const first = observeAppMapScreenAlias(
    mapFixture(),
    "settings",
    observation(localeNodes),
    context("alias-observe-1"),
  );
  const second = observeAppMapScreenAlias(
    first.appMap,
    "settings",
    observation(localeNodes),
    context("alias-observe-2", 1),
  );
  assert.deepEqual(second.alias.aliasesNow, [localeFingerprint]);
  assert.deepEqual(second.appMap.screens.settings?.identity?.aliases, [localeFingerprint]);

  const preExisting = observeAppMapScreenAlias(
    mapFixture({ aliases: [localeFingerprint] }),
    "settings",
    observation(localeNodes),
    context("alias-observe-3"),
  );
  assert.deepEqual(preExisting.alias.aliasesNow, [localeFingerprint]);
});

test("alias-observe observing the primary fingerprint adds no alias", () => {
  const result = observeAppMapScreenAlias(
    mapFixture({ fingerprint: localeFingerprint }),
    "settings",
    observation(localeNodes),
    context("alias-observe-1"),
  );

  const identity = result.appMap.screens.settings?.identity;
  assert.equal(identity?.fingerprint, localeFingerprint);
  assert.equal(identity?.aliases, undefined);
  assert.deepEqual(result.alias, { fingerprint: localeFingerprint, aliasesNow: [] });
});

test("alias-observe fills an identity-less screen with the observed fingerprint", () => {
  const result = observeAppMapScreenAlias(
    mapFixture({ fingerprint: "" }),
    "settings",
    observation(localeNodes),
    context("alias-observe-1"),
  );

  const identity = result.appMap.screens.settings?.identity;
  assert.deepEqual(identity, { schemaVersion: 1, fingerprint: localeFingerprint });
  assert.deepEqual(result.alias, { fingerprint: localeFingerprint, aliasesNow: [] });
});

test("alias-observe fails closed on an empty observation", () => {
  assert.throws(
    () => observeAppMapScreenAlias(mapFixture(), "settings", observation([]), context("alias-x")),
    /alias observation is empty/u,
  );
  const missingTree = observation(localeNodes);
  delete missingTree.nodes;
  assert.throws(
    () => observeAppMapScreenAlias(mapFixture(), "settings", missingTree, context("alias-x")),
    /alias observation is empty/u,
  );
});

test("alias-observe rejects a capture profile outside the approved target", () => {
  assert.throws(
    () =>
      observeAppMapScreenAlias(
        mapFixture(),
        "settings",
        observation(localeNodes),
        context("alias-scope-mismatch"),
        {
          target: { kind: "browser", platform: "browser", targetId: "managed-settings" },
          targetProfile: {
            id: "browser:other-settings",
            targetId: "other-settings",
            source: "browser",
            platform: "browser",
            name: "Other settings",
            capabilities: ["snapshot"],
            observedAt: 2,
          },
        },
      ),
    /does not belong to managed-settings/u,
  );
});

test("alias-observe fails closed on a stale semantic proof", () => {
  assert.throws(
    () =>
      observeAppMapScreenAlias(
        mapFixture(),
        "settings",
        observation(localeNodes, {
          schemaVersion: 1,
          captureOrder: "concurrent",
          pixels: { status: "unavailable" },
          semantics: { status: "stale" },
        }),
        context("alias-x"),
      ),
    /alias observation is stale/u,
  );
});

test("alias-observe rejects an unknown screen and a fingerprint owned by another screen", () => {
  assert.throws(
    () => observeAppMapScreenAlias(mapFixture(), "nope", observation(localeNodes), context("a")),
    /Screen nope does not exist/u,
  );

  const contested = mapFixture();
  contested.screens.other = {
    organizationId: "org-1",
    projectId: "project-1",
    appMapId: "map-1",
    id: "other",
    title: "Other",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
    identity: { schemaVersion: 1, fingerprint: localeFingerprint },
  };
  assert.throws(
    () => observeAppMapScreenAlias(contested, "settings", observation(localeNodes), context("a")),
    /already approved for screen other/u,
  );
});
