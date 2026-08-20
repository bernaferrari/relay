import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode, SnapshotState } from "../lib/api-types";
import type { AuthoringSession } from "@relay/protocol";
import {
  buildTapTarget,
  canRetryTapAtPoint,
  currentIosSemanticGeometry,
  canFlushBufferedTypeAfterLiveInput,
  logicalBoundsFromCapture,
  physicalIosTapStep,
  projectTake,
  selectProjectedAuthoringSession,
  semanticTapNode,
  stableLiveTapStep,
  supersededReviewSessionIds,
} from "./recorder";

test("a buffered type never follows an iOS outcome-unknown keyboard command", () => {
  assert.equal(canFlushBufferedTypeAfterLiveInput({ status: "succeeded" }), true);
  assert.equal(canFlushBufferedTypeAfterLiveInput({ status: "failed" }), true);
  assert.equal(
    canFlushBufferedTypeAfterLiveInput({
      status: "ios-outcome-unknown",
      iosFailure: { code: "IOS_MUTATION_OUTCOME_UNKNOWN" },
      intervention: {
        title: "Action may already have happened",
        detail: "Capture the current screen before any retry.",
        screenshotCaption: "review before retry · type text",
        operation: "type",
      },
    }),
    false,
  );
});

test("pixels-only live drive uses screenshot size when AX bounds are missing", () => {
  assert.deepEqual(logicalBoundsFromCapture({ imageWidth: 1668, imageHeight: 2224 }), {
    width: 834,
    height: 1112,
  });
  assert.deepEqual(
    logicalBoundsFromCapture({
      snapshot: {
        capturedAt: 1,
        nodes: [],
        interactive: [],
        inspectable: false,
        source: "pixels-only",
      },
      imageWidth: 1080,
      imageHeight: 2340,
    }),
    { width: 540, height: 1170 },
  );
  assert.equal(logicalBoundsFromCapture({ snapshot: null }), undefined);
});

test("iOS semantic geometry is usable only while its runtime proof is current", () => {
  const base: SnapshotState = {
    capturedAt: 1,
    nodes: [],
    interactive: [],
    readiness: {
      previewPixels: { mode: "pixels", state: "proven", freshness: "current", proof: { at: 1 } },
      semanticControl: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: 1, observedNodeCount: 1 },
      },
      evidenceCapture: { mode: "evidence", state: "unproven", freshness: "unproven" },
    },
  };
  assert.equal(currentIosSemanticGeometry(base), true);
  assert.equal(
    currentIosSemanticGeometry({
      ...base,
      readiness: {
        ...base.readiness!,
        semanticControl: {
          ...base.readiness!.semanticControl,
          freshness: "stale",
        },
      },
    }),
    false,
  );
  assert.equal(currentIosSemanticGeometry({ ...base, readiness: undefined }), false);
});

test("physical iOS falls back to coordinates for duplicate non-hittable labels", () => {
  const settings: SnapshotNode = {
    index: 2,
    ref: "@e52",
    label: "Settings",
    hittable: false,
    rect: { x: 617, y: 231.5, width: 68.5, height: 87.5 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [{ index: 1, ref: "@e29", label: "Settings", hittable: false }, settings],
    interactive: [],
    bounds: { width: 834, height: 1112 },
  };
  const target = buildTapTarget(snapshot.bounds, settings, 651 / 834, 275 / 1112);

  assert.deepEqual(physicalIosTapStep(snapshot, settings, target), {
    kind: "point",
    x: 651,
    y: 275,
  });
});

test("physical iOS live drive uses a unique hittable label at the control center", () => {
  const button: SnapshotNode = {
    index: 1,
    ref: "@e7",
    label: "General",
    hittable: true,
    rect: { x: 390, y: 530, width: 54, height: 52 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [button],
    interactive: [button],
    bounds: { width: 834, height: 1112 },
  };

  assert.deepEqual(
    physicalIosTapStep(snapshot, button, buildTapTarget(snapshot.bounds, button, 0.5, 0.5)),
    { kind: "label", label: "General", x: 417, y: 556 },
  );
});

test("physical iOS live drive uses a unique identifier at the control center", () => {
  const gear: SnapshotNode = {
    index: 1,
    identifier: "sidebar.settings.button",
    label: "grok-gear",
    hittable: false,
    rect: { x: 720, y: 1040, width: 44, height: 44 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [gear],
    interactive: [],
    bounds: { width: 834, height: 1112 },
  };
  assert.deepEqual(
    physicalIosTapStep(snapshot, gear, buildTapTarget(snapshot.bounds, gear, 0.89, 0.95)),
    { kind: "identifier", identifier: "sidebar.settings.button", x: 742, y: 1062 },
  );
});

test("physical iOS can still prefer a uniquely hittable ref when recording", () => {
  const button: SnapshotNode = {
    index: 1,
    ref: "@e7",
    label: "General",
    hittable: true,
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [button],
    interactive: [button],
    bounds: { width: 834, height: 1112 },
  };

  assert.deepEqual(
    physicalIosTapStep(snapshot, button, buildTapTarget(snapshot.bounds, button, 0.5, 0.5), {
      preferRef: true,
    }),
    { kind: "ref", ref: "@e7" },
  );
});

test("resource identifiers are recorded as stable targets, not accessibility labels", () => {
  assert.deepEqual(
    buildTapTarget(
      { width: 100, height: 200 },
      { identifier: "com.example:id/random_42", ref: "@e9" },
      0.25,
      0.5,
    ),
    {
      identifier: "com.example:id/random_42",
      ref: "@e9",
      point: {
        x: 25,
        y: 100,
        anchor: { horizontal: "left", vertical: "top" },
        referenceBounds: { width: 100, height: 200 },
      },
    },
  );
});

test("an unlabeled tapped child inherits the closest accessibility label", () => {
  const parent: SnapshotNode = {
    index: 0,
    label: "Account",
    ref: "@e1",
    rect: { x: 0, y: 0, width: 100, height: 50 },
  };
  const child: SnapshotNode = {
    index: 1,
    parentIndex: 0,
    identifier: "com.example:id/icon",
    ref: "@e2",
    rect: { x: 10, y: 10, width: 20, height: 20 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [parent, child],
    interactive: [child],
    bounds: { width: 100, height: 200 },
  };

  const semantic = semanticTapNode(snapshot, child);
  assert.equal(semantic, parent);
  assert.deepEqual(buildTapTarget(snapshot.bounds, semantic, 0.2, 0.1), {
    ref: "@e1",
    label: "Account",
    point: {
      x: 20,
      y: 20,
      anchor: { horizontal: "left", vertical: "top" },
      referenceBounds: { width: 100, height: 200 },
    },
  });
});

test("a full-screen accessibility overlay never replaces the exact mouse point", () => {
  const overlay: SnapshotNode = {
    index: 0,
    identifier: "com.google.android.gm:id/conversation_topmost_overlay",
    ref: "@e27",
    rect: { x: 0, y: 0, width: 1080, height: 2340 },
  };
  const snapshot: SnapshotState = {
    capturedAt: 1,
    nodes: [overlay],
    interactive: [],
    bounds: { width: 1080, height: 2340 },
  };

  assert.equal(semanticTapNode(snapshot, overlay), null);
  assert.equal(canRetryTapAtPoint(new Error("Selector did not match: id=overlay")), true);
  assert.equal(
    canRetryTapAtPoint(new Error("press coordinate tap left Gmail and foregrounded Niagara")),
    false,
  );
});

test("live Android fallback never executes an ephemeral ref", () => {
  const target = buildTapTarget(
    { width: 1080, height: 2340 },
    {
      ref: "@e27",
      label: "Maps",
      rect: { x: 220, y: 130, width: 680, height: 110 },
    },
    0.55,
    0.08,
  );

  assert.deepEqual(stableLiveTapStep(target), {
    kind: "label",
    label: "Maps",
    point: { x: 594, y: 187 },
  });
});

test("live Android fallback uses the mirrored point when the frame has no stable name", () => {
  assert.deepEqual(
    stableLiveTapStep({
      ref: "@e9",
      point: { x: 320, y: 640 },
    }),
    { kind: "point", x: 320, y: 640 },
  );
});

test("remote authoring activity is visible without replacing local App Map or Target focus", () => {
  const session = (
    id: string,
    actorId: string,
    targetId: string,
    updatedAt: number,
  ): AuthoringSession => ({
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    actorId,
    actorKind: actorId.startsWith("agent:") ? "agent" : "human",
    appMapId: "map-a",
    state: "recording",
    target: { kind: "device", platform: "android", targetId },
    leaseId: `lease-${id}`,
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt,
  });
  const selectedTarget = "device-a";
  const projected = selectProjectedAuthoringSession(
    [session("remote", "agent:indexer", "device-a", 3), session("other", "agent:b", "device-b", 4)],
    { appMapId: "map-a", targetId: selectedTarget, actorId: "human:me" },
  );
  assert.equal(projected?.id, "remote");
  assert.equal(selectedTarget, "device-a");
});

test("a collaborator's stopped Take never replaces the local canvas", () => {
  const remote = {
    schemaVersion: 1,
    id: "remote-review",
    organizationId: "local",
    projectId: "default",
    actorId: "agent:indexer",
    actorKind: "agent",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-remote",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 2,
  } satisfies AuthoringSession;
  assert.equal(
    selectProjectedAuthoringSession([remote], {
      appMapId: "map-a",
      targetId: "device-a",
      actorId: "human:me",
    }),
    null,
  );
});

test("a failed authoring attempt does not remain the active recorder", () => {
  const failed: AuthoringSession = {
    schemaVersion: 1,
    id: "failed",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "failed",
    target: { kind: "device", platform: "ios", targetId: "ipad" },
    leaseId: "expired-lease",
    expectedAppMapRevision: 1,
    error: "The target lease is unavailable",
    createdAt: 1,
    updatedAt: 2,
  };
  assert.equal(
    selectProjectedAuthoringSession([failed], {
      appMapId: "map-a",
      targetId: "ipad",
      actorId: "human:me",
    }),
    null,
  );
});

test("a locally completed session closes immediately while a stale refresh is in flight", () => {
  const reviewing: AuthoringSession = {
    schemaVersion: 1,
    id: "reviewing",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "ios", targetId: "ipad" },
    leaseId: "lease-one",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 2,
  };
  assert.equal(
    selectProjectedAuthoringSession([reviewing], {
      appMapId: "map-a",
      targetId: "ipad",
      actorId: "human:me",
      dismissedSessionIds: new Set([reviewing.id]),
    }),
    null,
  );
});

test("leaving the newest review also dismisses superseded reviews for that map and device", () => {
  const review = (id: string, targetId: string, updatedAt: number): AuthoringSession => ({
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId },
    leaseId: `lease-${id}`,
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt,
  });
  const newest = review("new", "android-a", 30);

  assert.deepEqual(
    supersededReviewSessionIds(
      [review("old", "android-a", 20), review("other", "android-b", 10), newest],
      newest,
    ),
    ["old", "new"],
  );
});

test("Take projection preserves canonical zero-step and grouped action boundaries", () => {
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "session-1",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    pendingConnectionId: "connection-planned",
    createdAt: 1,
    updatedAt: 4,
    take: {
      id: "take-1",
      state: "reviewing",
      createdAt: 1,
      updatedAt: 4,
      currentRevision: 1,
      replayAttempts: [
        {
          id: "replay-old-revision",
          takeId: "take-1",
          takeRevision: 2,
          startedAt: 3,
          finishedAt: 4,
          outcome: "failed",
          evidence: [],
          error: "Old revision failed",
        },
        {
          id: "replay-current",
          takeId: "take-1",
          takeRevision: 1,
          startedAt: 4,
          finishedAt: 5,
          outcome: "passed",
          evidence: [],
        },
      ],
      revisions: [
        {
          id: "revision-1",
          takeId: "take-1",
          revision: 1,
          createdAt: 4,
          createdBy: "human:me",
          reason: "recording",
          evidence: [
            {
              id: "before-shot",
              kind: "screenshot",
              capturedAt: 1,
              uri: "relay://before.png",
              mime: "image/png",
            },
            {
              id: "after-shot",
              kind: "screenshot",
              capturedAt: 3,
              uri: "relay://after.png",
              mime: "image/png",
            },
          ],
          before: {
            id: "before-observation",
            capturedAt: 1,
            screen: {
              id: "screen-before",
              fingerprint: "before",
              capturedAt: 1,
              source: "recording",
            },
            evidenceIds: ["before-shot"],
            bounds: { width: 834, height: 1112 },
          },
          after: {
            id: "after-observation",
            capturedAt: 3,
            screen: {
              id: "screen-after",
              fingerprint: "after",
              capturedAt: 3,
              source: "recording",
            },
            evidenceIds: ["after-shot"],
            bounds: { width: 834, height: 1112 },
          },
          actions: [
            {
              id: "observe-action",
              source: "manual",
              recordedAt: 1,
              startedAt: 1,
              finishedAt: 1,
              steps: [],
              evidenceIds: [],
              label: "Wait for redirect",
            },
            {
              id: "grouped-action",
              source: "manual",
              recordedAt: 2,
              startedAt: 2,
              finishedAt: 3,
              steps: [
                { kind: "tap", target: { label: "Continue" } },
                { kind: "sleep", ms: 250 },
              ],
              evidenceIds: [],
            },
          ],
        },
      ],
    },
  };

  const take = projectTake(session, (uri) => `evidence:${uri}`);
  assert.ok(take);
  assert.equal(take.actions.length, 2);
  assert.deepEqual(
    take.actions.map((action) => ({
      id: action.id,
      start: action.stepStartIndex,
      steps: action.steps.length,
    })),
    [
      { id: "observe-action", start: 0, steps: 0 },
      { id: "grouped-action", start: 0, steps: 2 },
    ],
  );
  assert.deepEqual(take.actionIds, ["grouped-action", "grouped-action"]);
  assert.equal(take.steps.length, 2);
  assert.equal(take.pendingConnectionId, "connection-planned");
  assert.equal(take.sourceEvidenceUrl, "evidence:relay://before.png");
  assert.equal(take.destinationEvidenceUrl, "evidence:relay://after.png");
  assert.deepEqual(take.sourceViewport, { width: 834, height: 1112 });
  assert.deepEqual(take.latestReplay, { outcome: "passed" });
});

test("Take projection keeps recorded pauses visible and editable", () => {
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "session-timing",
    organizationId: "local",
    projectId: "default",
    actorId: "human:me",
    actorKind: "human",
    appMapId: "map-a",
    state: "reviewing",
    target: { kind: "device", platform: "android", targetId: "device-a" },
    leaseId: "lease-1",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 1_250,
    take: {
      id: "take-timing",
      state: "reviewing",
      createdAt: 1,
      updatedAt: 1_250,
      currentRevision: 1,
      replayAttempts: [],
      revisions: [
        {
          id: "revision-timing",
          takeId: "take-timing",
          revision: 1,
          createdAt: 1_250,
          createdBy: "human:me",
          reason: "recording",
          evidence: [],
          actions: [
            {
              id: "pause-action",
              source: "captured",
              label: "Recorded pause",
              recordedAt: 0,
              startedAt: 0,
              finishedAt: 1_250,
              steps: [{ kind: "sleep", ms: 1_250 }],
              evidenceIds: [],
            },
          ],
        },
      ],
    },
  };

  const take = projectTake(session, (uri) => uri);
  assert.equal(take?.actions[0]?.label, "Recorded pause");
  assert.deepEqual(take?.steps, [{ kind: "sleep", ms: 1_250 }]);
});
