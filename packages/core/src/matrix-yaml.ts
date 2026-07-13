import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";
import type { CompatibilityMatrix, TargetSelector } from "@relay/protocol";
import { validateCompatibilityMatrix } from "./matrix.js";

const SCHEMA_VERSION = 1;
const MAX_MATRIX_YAML_BYTES = 256_000;

export type MatrixYamlDocument = {
  schemaVersion: number;
  id: string;
  name: string;
  selectors: TargetSelector[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeNode(node: unknown): void {
  if (!node) return;
  if (!isNode(node)) throw new Error("unsupported YAML node in Relay matrix file");
  if (isAlias(node) || ("anchor" in node && Boolean(node.anchor))) {
    throw new Error("YAML anchors and aliases are not supported in Relay matrix files");
  }
  if (node.tag) throw new Error("custom YAML tags are not supported in Relay matrix files");
  if (isMap(node)) {
    for (const item of node.items) {
      assertSafeNode(item.key);
      assertSafeNode(item.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) assertSafeNode(item);
  } else if (!isScalar(node)) throw new Error("unsupported YAML node in Relay matrix file");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function parseSelector(value: unknown, index: number): TargetSelector {
  if (!isObject(value)) throw new Error(`selectors[${index}] must be an object`);
  const allowed = new Set([
    "targetIds",
    "platforms",
    "osVersionPrefixes",
    "nameIncludes",
    "requiredCapabilities",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown selectors[${index}] field: ${key}`);
  }
  for (const key of allowed) {
    const field = value[key];
    if (
      field !== undefined &&
      (!Array.isArray(field) || field.some((item) => typeof item !== "string"))
    ) {
      throw new Error(`selectors[${index}].${key} must be a list of strings`);
    }
  }
  return {
    ...(value.targetIds ? { targetIds: [...(value.targetIds as string[])] } : {}),
    ...(value.platforms
      ? { platforms: [...(value.platforms as NonNullable<TargetSelector["platforms"]>)] }
      : {}),
    ...(value.osVersionPrefixes
      ? { osVersionPrefixes: [...(value.osVersionPrefixes as string[])] }
      : {}),
    ...(value.nameIncludes ? { nameIncludes: [...(value.nameIncludes as string[])] } : {}),
    ...(value.requiredCapabilities
      ? {
          requiredCapabilities: [
            ...(value.requiredCapabilities as NonNullable<TargetSelector["requiredCapabilities"]>),
          ],
        }
      : {}),
  };
}

export function parseMatrixYaml(
  source: string,
  metadata: Pick<CompatibilityMatrix, "projectId" | "createdAt" | "updatedAt"> = {
    projectId: "default",
    createdAt: 0,
    updatedAt: 0,
  },
): CompatibilityMatrix {
  if (Buffer.byteLength(source, "utf8") > MAX_MATRIX_YAML_BYTES) {
    throw new Error("Relay matrix YAML exceeds the 256 KB limit");
  }
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    prettyErrors: true,
    stringKeys: true,
    merge: false,
  });
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message);
  assertSafeNode(document.contents);
  const value = document.toJS({ maxAliasCount: 0 });
  if (!isObject(value)) throw new Error("Relay matrix YAML must contain an object at the root");
  const allowed = new Set(["schemaVersion", "id", "name", "selectors"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown Relay matrix field: ${key}`);
  }
  if (value.schemaVersion !== SCHEMA_VERSION)
    throw new Error("unsupported Relay matrix schemaVersion");
  assertString(value.id, "id");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(value.id)) {
    throw new Error("id must use letters, numbers, and hyphens only");
  }
  assertString(value.name, "name");
  if (!Array.isArray(value.selectors)) throw new Error("selectors must be an array");
  const matrix: CompatibilityMatrix = {
    id: value.id,
    projectId: metadata.projectId,
    name: value.name,
    selectors: value.selectors.map(parseSelector),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
  validateCompatibilityMatrix(matrix);
  return matrix;
}

export function formatMatrixYaml(matrix: CompatibilityMatrix): string {
  const document: MatrixYamlDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: matrix.id,
    name: matrix.name,
    selectors: matrix.selectors,
  };
  return stringify(document, {
    indent: 2,
    lineWidth: 100,
    sortMapEntries: false,
    aliasDuplicateObjects: false,
  });
}

export function matrixYamlFilename(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid matrix id");
  return `${id}.relay.matrix.yaml`;
}
