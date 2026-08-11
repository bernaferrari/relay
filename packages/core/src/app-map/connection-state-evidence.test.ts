import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection } from "./model.js";
import { passiveStateClaimHasEvidence } from "./connection-state-evidence.js";

function fixture(afterSelected?: boolean): { map: AppMap; connection: Connection } {
  const scope = { organizationId: "local", projectId: "project", appMapId: "map" };
  const entity = { ...scope, createdAt: 1, updatedAt: 1 };
  const connection = {
    ...entity,
    id: "connection",
    fromScreenId: "before",
    destination: { kind: "screen", screenId: "after" },
    label: "Kids Mode · Off",
    state: "ready",
    actions: [{ id: "observe", kind: "passive", reason: "automatic" }],
  } as Connection;
  const observation = (selected?: boolean) => ({
    fingerprint: crypto.randomUUID(),
    volatileSignals: [],
    nodes: [
      {
        role: "android.widget.textview",
        label: "kids mode",
        value: "kids mode",
        ...(selected === undefined ? {} : { selected }),
      },
    ],
  });
  return {
    connection,
    map: {
      ...entity,
      schemaVersion: 1,
      id: "map",
      name: "Map",
      revision: 1,
      notes: {},
      groups: {},
      screens: {
        before: { ...entity, id: "before", title: "Before", variantIds: ["before-v"] },
        after: { ...entity, id: "after", title: "After", variantIds: ["after-v"] },
      },
      screenVariants: {
        "before-v": {
          ...entity,
          id: "before-v",
          screenId: "before",
          targetProfile: {
            id: "device:android",
            targetId: "android",
            source: "device",
            platform: "android",
            name: "Android",
            capabilities: ["snapshot"],
            observedAt: 1,
          },
          observation: observation(false),
          evidenceIds: [],
        },
        "after-v": {
          ...entity,
          id: "after-v",
          screenId: "after",
          targetProfile: {
            id: "device:android",
            targetId: "android",
            source: "device",
            platform: "android",
            name: "Android",
            capabilities: ["snapshot"],
            observedAt: 1,
          },
          observation: observation(afterSelected ?? false),
          evidenceIds: [],
        },
      },
      connections: { connection },
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
    } as AppMap,
  };
}

test("rejects passive state labels when the control state stayed the same", () => {
  const { map, connection } = fixture(false);
  assert.equal(passiveStateClaimHasEvidence(map, connection), false);
});

test("accepts a passive state label when semantic state changed", () => {
  const { map, connection } = fixture(true);
  connection.label = "Kids Mode · On";
  assert.equal(passiveStateClaimHasEvidence(map, connection), true);
});

test("rejects a passive state label when semantic state is unknown", () => {
  const { map, connection } = fixture();
  for (const variant of Object.values(map.screenVariants)) {
    for (const node of variant.observation?.nodes ?? []) delete node.selected;
  }
  assert.equal(passiveStateClaimHasEvidence(map, connection), false);
});

test("rejects a passive label that names the opposite of the observed destination", () => {
  const { map, connection } = fixture(true);
  connection.label = "Kids Mode · Off";
  assert.equal(passiveStateClaimHasEvidence(map, connection), false);
});

test("does not second-guess explicit actions", () => {
  const { map, connection } = fixture(false);
  connection.actions = [{ id: "tap", kind: "tap", target: { label: "Kids Mode" } }];
  assert.equal(passiveStateClaimHasEvidence(map, connection), true);
});
