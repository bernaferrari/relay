import test from "node:test";
import assert from "node:assert/strict";
import type { CompatibilityMatrix } from "@relay/protocol";
import { formatMatrixYaml, matrixYamlFilename, parseMatrixYaml } from "./matrix-yaml.js";

const matrix: CompatibilityMatrix = {
  id: "mobile-release",
  projectId: "default",
  name: "Mobile release targets",
  selectors: [
    { platforms: ["android"], osVersionPrefixes: ["14"], requiredCapabilities: ["lock-screen"] },
    { platforms: ["ios"], nameIncludes: ["iPhone"] },
  ],
  createdAt: 1,
  updatedAt: 2,
};

test("matrix YAML is canonical and round-trips without runtime metadata", () => {
  const yaml = formatMatrixYaml(matrix);
  assert.match(yaml, /schemaVersion: 1/);
  assert.match(yaml, /requiredCapabilities:/);
  assert.deepEqual(parseMatrixYaml(yaml), {
    ...matrix,
    createdAt: 0,
    updatedAt: 0,
  });
});

test("matrix YAML rejects unknown fields and unsafe aliases", () => {
  assert.throws(() => parseMatrixYaml("schemaVersion: 1\nid: x\nname: X\nextra: true\n"));
  assert.throws(() =>
    parseMatrixYaml("schemaVersion: 1\nid: x\nname: X\nselectors: &s []\ncopy: *s\n"),
  );
});

test("matrix YAML uses a stable git-friendly filename", () => {
  assert.equal(matrixYamlFilename("mobile-release"), "mobile-release.relay.matrix.yaml");
  assert.throws(() => matrixYamlFilename("../unsafe"));
});
