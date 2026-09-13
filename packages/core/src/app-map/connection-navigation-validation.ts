import type {
  ConnectionNavigationContract,
  ConnectionReturnContract,
  ScreenIdentity,
} from "@relay/protocol";
import { appMapFail } from "./errors.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  stringArray,
} from "./validation-primitives.js";

export function assertIdentity(value: ScreenIdentity, label: string): void {
  if (value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(value.fingerprint)) {
    appMapFail("invalid-map", `${label} must contain a schema-v1 SHA-256 fingerprint`);
  }
  if (value.aliases !== undefined) {
    stringArray(value.aliases, `${label}.aliases`);
    if (value.aliases.some((alias) => !/^[a-f0-9]{64}$/u.test(alias))) {
      appMapFail("invalid-map", `${label}.aliases must contain SHA-256 fingerprints`);
    }
  }
  if (value.ignoreRegions === undefined) return;
  if (!Array.isArray(value.ignoreRegions) || value.ignoreRegions.length > 16) {
    appMapFail("invalid-map", `${label}.ignoreRegions must contain at most 16 regions`);
  }
  value.ignoreRegions.forEach((region, index) => {
    const regionLabel = `${label}.ignoreRegions[${index}]`;
    objectValue(region, regionLabel);
    if (
      typeof region.x !== "number" ||
      typeof region.y !== "number" ||
      typeof region.width !== "number" ||
      typeof region.height !== "number" ||
      !Number.isFinite(region.x) ||
      !Number.isFinite(region.y) ||
      !Number.isFinite(region.width) ||
      !Number.isFinite(region.height) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0
    ) {
      appMapFail("invalid-map", `${regionLabel} requires finite x, y, width, and height`);
    }
    if (region.name !== undefined && (typeof region.name !== "string" || !region.name.trim())) {
      appMapFail("invalid-map", `${regionLabel}.name must be a non-empty string`);
    }
  });
}

export function assertConnectionScreenProof(
  expected: ConnectionNavigationContract["expectedDestination"],
  label: string,
): void {
  objectValue(expected, label);
  identifier(expected.screenId, `${label}.screenId`);
  assertIdentity(expected.identity, `${label}.identity`);
  stringArray(expected.evidenceIds, `${label}.evidenceIds`);
  if (expected.evidenceIds.length === 0) {
    appMapFail("invalid-map", `${label}.evidenceIds must not be empty`);
  }
}

export function assertConnectionNavigation(
  navigation: ConnectionNavigationContract,
  label: string,
): void {
  objectValue(navigation, label);
  if (
    !Array.isArray(navigation.targetAlternatives) ||
    navigation.targetAlternatives.length === 0 ||
    navigation.targetAlternatives.length > 8
  ) {
    appMapFail("invalid-map", `${label}.targetAlternatives must contain 1 to 8 targets`);
  }
  const order = { identifier: 0, accessibility: 1, "element-relative": 2 } as const;
  let previous = -1;
  navigation.targetAlternatives.forEach((target, index) => {
    const targetLabel = `${label}.targetAlternatives[${index}]`;
    objectValue(target, targetLabel);
    const rank = order[target.kind];
    if (rank === undefined || rank < previous) {
      appMapFail(
        "invalid-map",
        `${label}.targetAlternatives must use identifier, accessibility, then element-relative order`,
      );
    }
    previous = rank;
    if (target.kind === "identifier") {
      requiredText(target.identifier, `${targetLabel}.identifier`);
      return;
    }
    if (target.kind === "accessibility") {
      requiredText(target.label, `${targetLabel}.label`);
      optionalText(target.role, `${targetLabel}.role`);
      return;
    }
    if (target.kind !== "element-relative") {
      appMapFail("invalid-map", `${targetLabel}.kind is unsupported`);
    }
    const anchor = objectValue(target.anchor, `${targetLabel}.anchor`);
    optionalText(anchor.identifier as string | undefined, `${targetLabel}.anchor.identifier`);
    optionalText(anchor.label as string | undefined, `${targetLabel}.anchor.label`);
    optionalText(anchor.role as string | undefined, `${targetLabel}.anchor.role`);
    if (!anchor.identifier && !anchor.label) {
      appMapFail("invalid-map", `${targetLabel}.anchor requires an identifier or label`);
    }
    assertNormalizedCoordinate(target.xRatio, `${targetLabel}.xRatio`);
    assertNormalizedCoordinate(target.yRatio, `${targetLabel}.yRatio`);
    finiteTimestamp(target.reviewedAt, `${targetLabel}.reviewedAt`);
    requiredText(target.reviewedBy, `${targetLabel}.reviewedBy`);
    stringArray(target.evidenceIds, `${targetLabel}.evidenceIds`);
    if (target.evidenceIds.length === 0) {
      appMapFail("invalid-map", `${targetLabel}.evidenceIds must not be empty`);
    }
  });
  assertConnectionScreenProof(navigation.expectedDestination, `${label}.expectedDestination`);
}

export function assertConnectionReturn(value: ConnectionReturnContract, label: string): void {
  objectValue(value, label);
  if (value.kind !== "back") {
    appMapFail("invalid-map", `${label}.kind must be back`);
  }
  assertConnectionScreenProof(value.expectedDestination, `${label}.expectedDestination`);
  optionalText(value.expectedApp, `${label}.expectedApp`);
}

function assertNormalizedCoordinate(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    appMapFail("invalid-map", `${label} must be a finite coordinate between 0 and 1`);
  }
}
