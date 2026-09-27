import assert from "node:assert/strict";
import test from "node:test";

import type { AppMap } from "@relay/protocol";
import type { PersistedRun } from "./runs.js";
import { buildPlayerManifest, resolvePlayerCapture } from "./player-manifest.js";

const APP_MAP_SCHEMA_VERSION = 1;

function fixtureMap(): AppMap {
  const screens = {
    "screen-home": { id: "screen-home", title: "Member home", variantIds: [] },
    "screen-settings": { id: "screen-settings", title: "Workspace settings", variantIds: [] },
    "screen-language": { id: "screen-language", title: "Preferred language", variantIds: [] },
  };
  const connections = {
    "open-settings": {
      id: "open-settings",
      fromScreenId: "screen-home",
      destination: { kind: "screen", screenId: "screen-settings" },
      label: "Member settings",
      state: "ready",
      actions: [{ kind: "tap", target: { label: "Settings" } }],
      sourceAnchor: { point: { x: 0.5, y: 0.1 } },
    },
    "open-language": {
      id: "open-language",
      fromScreenId: "screen-settings",
      destination: { kind: "screen", screenId: "screen-language" },
      label: "Preferred language",
      state: "ready",
      actions: [{ kind: "tap", target: { label: "Language" } }],
      sourceAnchor: { point: { x: 0.1, y: 0.4 } },
    },
    // Authored link: wired on the map, never executed by any included run.
    "home-shortcut": {
      id: "home-shortcut",
      fromScreenId: "screen-language",
      destination: { kind: "screen", screenId: "screen-home" },
      label: "Back to home",
      state: "draft",
      actions: [{ kind: "tap", target: { label: "Home" } }],
    },
  };
  const tests = {
    "test-member-v2": {
      id: "test-member-v2",
      name: "Member settings reference v2",
      steps: [
        {
          id: "member-open-settings",
          intent: "Settings",
          capture: true,
          kind: "instruction",
          binding: { status: "resolved", kind: "connections", connectionIds: ["open-settings"] },
        },
        {
          id: "member-open-language",
          intent: "Language",
          capture: true,
          kind: "instruction",
          binding: { status: "resolved", kind: "connections", connectionIds: ["open-language"] },
        },
      ],
      capture: { mode: "final-screen" },
    },
  };
  return {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: "slice4-reference",
    organizationId: "local",
    projectId: "default",
    name: "Slice 4 reference",
    revision: 63,
    notes: {},
    groups: {},
    screens,
    screenVariants: {},
    connections,
    tests,
  } as unknown as AppMap;
}

function reviewArtifact(input: {
  frame: string;
  sha: string;
  checkpointId: string;
  configuration: Record<string, string>;
  capturedAt: number;
  slotId?: string;
  laneId?: string;
}): PersistedRun["artifacts"][number] {
  return {
    kind: "capture-review",
    capturedAt: input.capturedAt,
    data: {
      status: "pending",
      caption: `step:${input.checkpointId}`,
      lookFor: "Settings",
      framePath: input.frame,
      imageSha256: input.sha,
      slotId: input.slotId ?? `test-member-v2::${input.checkpointId}::member`,
      requirementId: "test-member-v2",
      checkpointId: input.checkpointId,
      attempt: 1,
      configuration: input.configuration,
      observed: { laneId: input.laneId ?? "slice4-member" },
    },
  };
}

function transitionProof(
  connectionId: string,
  originScreenId: string,
  destinationScreenId: string,
  capturedAt: number,
): PersistedRun["artifacts"][number] {
  return {
    kind: "campaign-transition-proof",
    capturedAt,
    data: {
      connectionId,
      originScreenId,
      destination: { kind: "screen", screenId: destinationScreenId },
      status: "verified",
    },
  };
}

function run(input: {
  id: string;
  artifacts: PersistedRun["artifacts"];
  captureReviews?: PersistedRun["captureReviews"];
}): PersistedRun {
  return {
    id: input.id,
    schemaVersion: 5,
    projectId: "default",
    ownerId: "local",
    action: "app-map.test.run",
    status: "ok",
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 30,
    artifacts: input.artifacts,
    ...(input.captureReviews ? { captureReviews: input.captureReviews } : {}),
  } as unknown as PersistedRun;
}

test("§6.6 fixture: three states, recorded and authored links, two configurations, one missing", () => {
  const memberHomeSha = "a".repeat(64);
  const memberSettingsSha = "b".repeat(64);
  const memberLanguageSha = "c".repeat(64);
  const adminSettingsSha = "d".repeat(64);
  const memberConfig = { browser: "firefox", account: "member" };
  const adminConfig = { browser: "chrome", account: "admin" };

  const manifest = buildPlayerManifest({
    map: fixtureMap(),
    runs: [
      run({
        id: "run-member",
        artifacts: [
          transitionProof("open-settings", "screen-home", "screen-settings", 8),
          transitionProof("open-language", "screen-settings", "screen-language", 9),
          reviewArtifact({
            frame: "frames/001.png",
            sha: memberHomeSha,
            checkpointId: "member-open-settings",
            configuration: memberConfig,
            capturedAt: 10,
          }),
          reviewArtifact({
            frame: "frames/002.png",
            sha: memberSettingsSha,
            checkpointId: "member-open-settings",
            configuration: memberConfig,
            capturedAt: 20,
          }),
          reviewArtifact({
            frame: "frames/003.png",
            sha: memberLanguageSha,
            checkpointId: "member-open-language",
            configuration: memberConfig,
            capturedAt: 30,
          }),
        ],
      }),
      run({
        id: "run-admin",
        artifacts: [
          transitionProof("open-settings", "screen-home", "screen-settings", 24),
          reviewArtifact({
            frame: "frames/001.png",
            sha: adminSettingsSha,
            checkpointId: "member-open-settings",
            configuration: adminConfig,
            capturedAt: 25,
            laneId: "slice4-admin",
          }),
        ],
      }),
    ],
    now: 99,
  });

  // Three logical states from the identity chain, not screenshot similarity.
  assert.deepEqual([...manifest.states].map((state) => state.title).sort(), [
    "Member home",
    "Preferred language",
    "Workspace settings",
  ]);

  // Two exact configurations become two variants.
  assert.equal(manifest.variants.length, 2);

  // Exact transition proofs make the executed connections recorded;
  // home-shortcut remains an authored link.
  const byId = new Map(manifest.connections.map((connection) => [connection.id, connection]));
  assert.equal(byId.get("open-settings")?.kind, "recorded");
  assert.deepEqual(
    manifest.connections
      .filter((connection) => connection.id === "open-settings")
      .map((connection) => connection.provenance?.runId)
      .sort(),
    ["run-admin", "run-member"],
  );
  assert.equal(byId.get("open-language")?.kind, "recorded");
  assert.equal(byId.get("home-shortcut")?.kind, "authored");
  assert.equal(byId.get("home-shortcut")?.provenance, undefined);

  // Hotspots carry normalized source-viewport geometry and the recorded
  // action fallback exists for the authored link without an anchor.
  assert.deepEqual(byId.get("open-settings")?.hotspot?.point, { x: 0.5, y: 0.1 });
  assert.deepEqual(byId.get("home-shortcut")?.hotspot?.actions, [{ kind: "tap" }]);

  // Exact resolution: member settings uses the newest member capture;
  // admin settings resolves to the admin image, never the member image.
  const memberSettings = resolvePlayerCapture(
    manifest,
    "screen-settings",
    "account=member · browser=firefox @ slice4-member",
  );
  assert.equal(memberSettings?.imageSha256, memberSettingsSha);
  const adminSettings = resolvePlayerCapture(
    manifest,
    "screen-settings",
    "account=admin · browser=chrome @ slice4-admin",
  );
  assert.equal(adminSettings?.imageSha256, adminSettingsSha);

  // Wrong variants cannot substitute: language has no admin capture, and
  // resolution under the admin variant returns nothing rather than the
  // member image. The pair is listed as missing.
  assert.equal(
    resolvePlayerCapture(
      manifest,
      "screen-language",
      "account=admin · browser=chrome @ slice4-admin",
    ),
    undefined,
  );
  assert.deepEqual(
    manifest.missing.map((entry) => [entry.stateId, entry.variantId]),
    [["screen-language", "account=admin · browser=chrome @ slice4-admin"]],
  );

  // Pinning: the manifest names its evidence.
  assert.deepEqual(manifest.pinned.runIds, ["run-member", "run-admin"]);
  assert.equal(manifest.pinned.appMapRevision, 63);
});

test("a review decision binds to one exact capture as a finding", () => {
  const sha = "e".repeat(64);
  const manifest = buildPlayerManifest({
    map: fixtureMap(),
    runs: [
      run({
        id: "run-member",
        artifacts: [
          reviewArtifact({
            frame: "frames/002.png",
            sha,
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 20,
          }),
        ],
        captureReviews: [
          {
            captureId: `frames/002.png::${sha}`,
            action: "report-issue",
            decidedAt: 40,
            decidedBy: { id: "human:demo", kind: "human" },
            note: "Save overlaps the seats row",
            reviewVersion: 1,
          },
        ],
      }),
    ],
  });
  assert.equal(manifest.findings.length, 1);
  const finding = manifest.findings[0]!;
  assert.equal(finding.runId, "run-member");
  assert.equal(finding.captureId, `frames/002.png::${sha}`);
  assert.equal(finding.action, "report-issue");
  assert.equal(finding.decidedBy, "human:demo");
  // The finding binds the exact capture identity, including the digest.
  assert.ok(
    manifest.captures.some(
      (capture) => capture.runId === "run-member" && capture.imageSha256 === sha,
    ),
  );
});

test("a destination capture or recording provenance alone never proves an action", () => {
  const map = fixtureMap();
  (map.connections as Record<string, { provenance?: { source: string } }>)[
    "open-settings"
  ]!.provenance = { source: "recording" };
  const manifest = buildPlayerManifest({
    map,
    runs: [
      run({
        id: "capture-only",
        artifacts: [
          reviewArtifact({
            frame: "frames/001.png",
            sha: "f".repeat(64),
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 20,
          }),
        ],
      }),
    ],
  });
  const connection = manifest.connections.find((item) => item.id === "open-settings");
  assert.equal(connection?.kind, "authored");
  assert.equal(connection?.provenance, undefined);
  assert.equal(manifest.captures.length, 1);
});

test("a verified transition without a destination image keeps proof separate from pixels", () => {
  const manifest = buildPlayerManifest({
    map: fixtureMap(),
    runs: [
      run({
        id: "proof-only-transition",
        artifacts: [
          transitionProof("open-language", "screen-settings", "screen-language", 10),
          reviewArtifact({
            frame: "frames/settings.png",
            sha: "a".repeat(64),
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 20,
          }),
        ],
      }),
    ],
  });
  const connection = manifest.connections.find((item) => item.id === "open-language");
  assert.equal(connection?.kind, "recorded");
  assert.deepEqual(connection?.provenance, { runId: "proof-only-transition" });
  assert.equal(
    resolvePlayerCapture(
      manifest,
      "screen-language",
      "account=member · browser=firefox @ slice4-member",
    ),
    undefined,
  );
});

test("no captures yields an empty manifest, not invented states or links", () => {
  const manifest = buildPlayerManifest({ map: fixtureMap(), runs: [] });
  assert.equal(manifest.captures.length, 0);
  assert.equal(manifest.states.length, 0);
  assert.equal(manifest.connections.length, 0);
  assert.equal(manifest.missing.length, 0);
  assert.equal(manifest.entryStateId, undefined);
});

test("captions never create identity: two same-caption captures stay distinct", () => {
  const manifest = buildPlayerManifest({
    map: fixtureMap(),
    runs: [
      run({
        id: "run-member",
        artifacts: [
          reviewArtifact({
            frame: "frames/002.png",
            sha: "1".repeat(64),
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 20,
          }),
        ],
      }),
      run({
        id: "run-member-2",
        artifacts: [
          reviewArtifact({
            frame: "frames/002.png",
            sha: "2".repeat(64),
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 21,
          }),
        ],
      }),
    ],
  });
  // Same caption, different exact captures; the newest wins resolution and
  // both stay in evidence.
  assert.equal(manifest.captures.length, 2);
  const resolved = resolvePlayerCapture(
    manifest,
    "screen-settings",
    "account=member · browser=firefox @ slice4-member",
  );
  assert.equal(resolved?.imageSha256, "2".repeat(64));
});

test("discovery and unproved recording links never become recorded transitions", () => {
  const map = fixtureMap();
  const connections = map.connections as unknown as Record<
    string,
    { provenance?: { source: string } }
  >;
  connections["open-settings"]!.provenance = { source: "discovery" };
  connections["home-shortcut"]!.provenance = { source: "manual" };
  connections["open-language"]!.provenance = { source: "recording" };
  const manifest = buildPlayerManifest({
    map,
    runs: [
      run({
        id: "run-member",
        artifacts: [
          reviewArtifact({
            frame: "frames/002.png",
            sha: "b".repeat(64),
            checkpointId: "member-open-settings",
            configuration: { browser: "firefox", account: "member" },
            capturedAt: 20,
          }),
        ],
      }),
    ],
    now: 1,
  });
  const byId = new Map(manifest.connections.map((connection) => [connection.id, connection]));
  assert.equal(byId.get("open-settings")?.kind, "suggested");
  assert.equal(byId.get("open-settings")?.provenance, undefined);
  assert.deepEqual(byId.get("open-settings")?.hotspot?.point, { x: 0.5, y: 0.1 });
  assert.equal(byId.get("home-shortcut")?.kind, "authored");
  assert.equal(byId.get("open-language")?.kind, "authored");
  assert.equal(byId.get("open-language")?.provenance, undefined);
});
