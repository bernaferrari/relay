import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapMutationContext, AuthoringObservation } from "@relay/protocol";
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
