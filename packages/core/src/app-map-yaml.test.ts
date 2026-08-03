import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { formatAppMapYaml, parseAppMapYaml } from "./app-map-yaml.js";

function emptyMap(): AppMap {
  return {
    schemaVersion: 2,
    id: "checkout",
    organizationId: "source-org",
    projectId: "source-project",
    name: "Checkout",
    description: "A portable checkout map",
    revision: 0,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 100,
    updatedAt: 100,
  };
}

test("App Map YAML round-trips deterministically and can move between projects", () => {
  const yaml = formatAppMapYaml(emptyMap());
  assert.match(
    yaml,
    /^schemaVersion: 2\nid: checkout\norganizationId: source-org\nprojectId: source-project\nname: Checkout\ndescription:/u,
  );
  assert.equal(formatAppMapYaml(parseAppMapYaml(yaml)), yaml);
  const moved = parseAppMapYaml(yaml, {
    organizationId: "destination-org",
    projectId: "destination-project",
    appMapId: "checkout-copy",
  });
  assert.equal(moved.id, "checkout-copy");
  assert.equal(moved.organizationId, "destination-org");
  assert.equal(moved.projectId, "destination-project");
  assert.equal(moved.description, "A portable checkout map");
});

test("App Map YAML rejects aliases, duplicate ids, and unknown root fields", () => {
  assert.throws(
    () => parseAppMapYaml("schemaVersion: 2\nid: &id checkout\nname: *id\n"),
    /anchors and aliases/iu,
  );
  const duplicate = formatAppMapYaml({
    ...emptyMap(),
    screens: {
      welcome: {
        id: "welcome",
        organizationId: "source-org",
        projectId: "source-project",
        appMapId: "checkout",
        title: "Welcome",
        variantIds: [],
        createdAt: 100,
        updatedAt: 100,
      },
    },
  }).replace("screens:\n", "screens:\n");
  const screenBlock = duplicate.match(/screens:\n([\s\S]*?)screenVariants:/u)?.[1];
  assert.ok(screenBlock);
  const duplicatedScreens = duplicate.replace(
    `screens:\n${screenBlock}screenVariants:`,
    `screens:\n${screenBlock}${screenBlock}screenVariants:`,
  );
  assert.throws(() => parseAppMapYaml(duplicatedScreens), /duplicate id/iu);
  assert.throws(
    () => parseAppMapYaml(`${formatAppMapYaml(emptyMap())}surprise: true\n`),
    /unknown/iu,
  );
});
