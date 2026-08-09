import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapEntity, Connection, Screen } from "@relay/protocol";
import {
  assignableSwitcherConnections,
  localeLoopBodyFlowId,
  recordedLocalePreludeFromMap,
  taughtExampleFromSnapshotNode,
  teachableLocaleRows,
} from "./app-map-locale-teach";

test("clicked language row prefers a locale tag from the identifier", () => {
  assert.deepEqual(
    taughtExampleFromSnapshotNode({
      identifier: "lang.pt-BR",
      label: "Português (Brasil), Portuguese (Brazil)",
    }),
    {
      locale: "pt-BR",
      identifier: "lang.pt-BR",
      label: "Português (Brasil), Portuguese (Brazil)",
    },
  );
});

test("teachable rows keep iOS non-hittable cells and skip duplicates", () => {
  const rows = teachableLocaleRows([
    { identifier: "lang.en", label: "English", hittable: false },
    { identifier: "lang.en", label: "English", hittable: false },
    { identifier: "lang.it", label: "Italiano", hittable: false },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.identifier, "lang.en");
  assert.equal(rows[1]?.identifier, "lang.it");
});

test("teachable rows never present Android system chrome as list values", () => {
  const rows = teachableLocaleRows([
    { identifier: "com.android.systemui:id/navigation_bar_frame" },
    { identifier: "com.android.systemui:id/back", label: "Back" },
    { label: "01:48" },
    { label: "Reddit notification:" },
    { identifier: "model.high", label: "High" },
  ]);
  assert.deepEqual(rows, [{ identifier: "model.high", label: "High" }]);
});

const at = 1;
const scope = { organizationId: "org", projectId: "p", appMapId: "map-1" };
function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}
function screen(id: string, title: string): Screen {
  return {
    ...entity(id),
    title,
    identity: { schemaVersion: 1, fingerprint: id.padEnd(64, "a") },
    variantIds: [],
  };
}

function mapWithPickerAndCheckout(): AppMap {
  const checkout: Connection = {
    ...entity("to-checkout"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "checkout" },
    state: "ready",
    actions: [
      {
        id: "bag",
        kind: "recorded",
        takeId: "t1",
        takeRevision: 1,
        evidenceIds: [],
        steps: [{ kind: "tap", target: { label: "Bag" } }],
      },
    ],
  };
  const languages: Connection = {
    ...entity("to-languages"),
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "languages" },
    state: "ready",
    actions: [
      {
        id: "open",
        kind: "steps",
        steps: [
          { kind: "tap", target: { label: "Me" } },
          { kind: "tap", target: { text: "Language" } },
        ],
      },
    ],
  };
  return {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "Store",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: screen("home", "Home"),
      checkout: screen("checkout", "Checkout"),
      languages: screen("languages", "Languages"),
    },
    screenVariants: {},
    connections: { [checkout.id]: checkout, [languages.id]: languages },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {
      buy: {
        ...entity("buy"),
        name: "Buy",
        startScreenId: "home",
        connectionIds: ["to-checkout"],
      },
      picker: {
        ...entity("picker"),
        name: "Languages",
        startScreenId: "home",
        connectionIds: ["to-languages"],
      },
    },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("recorded prelude uses the language-list path, not the product checkout path", () => {
  const map = mapWithPickerAndCheckout();
  const prelude = recordedLocalePreludeFromMap(map, { bodyFlowId: "buy" });
  assert.equal(prelude?.sourceConnectionId, "to-languages");
  assert.equal(prelude?.sourceLabel, "Languages");
  assert.deepEqual(
    prelude?.entryPath.map((step) =>
      step.kind === "tap" ? (step.target?.label ?? step.target?.text) : step.kind,
    ),
    ["Me", "Language"],
  );
  assert.equal(localeLoopBodyFlowId(map, prelude?.sourceConnectionId), "buy");
});

test("assignable switcher connections are recorded paths with labels", () => {
  const map = mapWithPickerAndCheckout();
  const rows = assignableSwitcherConnections(map);
  assert.ok(rows.some((row) => row.id === "to-languages"));
  assert.ok(rows.some((row) => /language/i.test(row.label)));
});

test("product-only map has no recorded picker prelude", () => {
  const map = mapWithPickerAndCheckout();
  delete map.connections["to-languages"];
  delete map.flows.picker;
  assert.equal(recordedLocalePreludeFromMap(map, { bodyFlowId: "buy" }), undefined);
});
