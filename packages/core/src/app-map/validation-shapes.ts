import { parseAuthoringCaptureReview, type TargetProfile } from "@relay/protocol";
import {
  isRoutineAccountIsolation,
  isRoutineLeftoverSurface,
  isRoutineSharingPolicy,
  isRoutineStartingStateFact,
  type RoutineEffects,
} from "@relay/protocol";
import { appMapFail } from "./errors.js";
import { browserTargetProfileProblem } from "./validation-target-profile.js";
import type {
  AddScreenInput,
  AppMapNote,
  AppMapScope,
  BaselineProvenance,
  CaseStack,
  AppMapTest,
  AppMapCombine,
  Connection,
  ConnectionPatch,
  ConnectionPresentation,
  Flow,
  MapGroup,
  Proposal,
  ProposalChange,
  Routine,
  RunReference,
  Screen,
  ScreenVariant,
  TargetResultReference,
  UpdateScreenInput,
} from "./model.js";
import type { ScreenIdentityObservation } from "../screen-identity.js";
import { assertActions } from "./action-validation.js";
import {
  assertConnectionNavigation,
  assertConnectionReturn,
  assertIdentity,
} from "./connection-navigation-validation.js";
import { assertEntity } from "./entity-validation.js";
import { assertProposalRepair } from "./proposal-repair-validation.js";
import { assertScenarioTest } from "./test-intent-validation.js";
import { assertRepeatPolicy } from "./repeat-policy-validation.js";
import { assertReviewedBinding } from "./reviewed-bindings-validation.js";
import { assertScreenPatch } from "./screen-patch-validation.js";
export { assertRun, assertTargetResult } from "./run-result-validation.js";
import { assertRun, assertTargetResult } from "./run-result-validation.js";
import { assertFlow, assertRoutine, assertRoutineEffects } from "./routine-flow-validation.js";
export { assertFlow, assertRoutine, assertRoutineEffects } from "./routine-flow-validation.js";
export { assertScreenPatch } from "./screen-patch-validation.js";
import {
  assertLogicalScrollSurface,
  assertScrollSurfaceCapturePolicy,
} from "./scroll-surface-validation.js";
import {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";
export {
  finiteTimestamp,
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
} from "./validation-primitives.js";

export { assertActivity } from "./activity-validation.js";
export { assertAppMapVariable } from "./variable-validation.js";

function assertObservation(value: ScreenIdentityObservation, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value.fingerprint)) {
    appMapFail("invalid-map", `${label}.fingerprint must be a SHA-256 fingerprint`);
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.volatileSignals)) {
    appMapFail("invalid-map", `${label} must contain nodes and volatileSignals arrays`);
  }
  value.nodes.forEach((node, index) => {
    objectValue(node, `${label}.nodes[${index}]`);
    if (typeof node.role !== "string") {
      appMapFail("invalid-map", `${label}.nodes[${index}].role must be a string`);
    }
  });
  value.volatileSignals.forEach((signal, index) => {
    objectValue(signal, `${label}.volatileSignals[${index}]`);
    safeInteger(signal.node, `${label}.volatileSignals[${index}].node`);
  });
}

export function assertTargetProfile(value: TargetProfile, label: string): void {
  objectValue(value, label);
  identifier(value.id, `${label}.id`);
  identifier(value.targetId, `${label}.targetId`);
  if (!(value.source === "device" || value.source === "browser")) {
    appMapFail("invalid-map", `${label}.source is unsupported`);
  }
  if (!(value.platform === "android" || value.platform === "ios" || value.platform === "browser")) {
    appMapFail("invalid-map", `${label}.platform is unsupported`);
  }
  if (value.androidAvdName !== undefined) {
    requiredText(value.androidAvdName, `${label}.androidAvdName`);
    if (value.platform !== "android") {
      appMapFail("invalid-map", `${label}.androidAvdName requires an Android target`);
    }
  }
  requiredText(value.name, `${label}.name`);
  if (!Array.isArray(value.capabilities)) {
    appMapFail("invalid-map", `${label}.capabilities must be an array`);
  }
  const supported = new Set([
    "snapshot",
    "screenshot",
    "stream",
    "recording",
    "tap",
    "type",
    "scroll",
    "clipboard",
    "network",
    "logs",
    "permissions",
    "location",
    "rotation",
    "lock-screen",
    "app-switcher",
  ]);
  if (
    value.capabilities.some((capability) => !supported.has(capability)) ||
    new Set(value.capabilities).size !== value.capabilities.length
  ) {
    appMapFail(
      "invalid-map",
      `${label}.capabilities contains an unsupported or duplicate capability`,
    );
  }
  if (
    (value.source === "browser" && value.platform !== "browser") ||
    (value.source === "device" && value.platform === "browser")
  ) {
    appMapFail("invalid-map", `${label}.source and platform are inconsistent`);
  }
  finiteTimestamp(value.observedAt, `${label}.observedAt`);
  if (value.viewport) {
    safeInteger(value.viewport.width, `${label}.viewport.width`);
    safeInteger(value.viewport.height, `${label}.viewport.height`);
    if (value.viewport.width === 0 || value.viewport.height === 0) {
      appMapFail("invalid-map", `${label}.viewport dimensions must be positive`);
    }
  }
  const browserProblem = browserTargetProfileProblem(value);
  if (browserProblem) appMapFail("invalid-map", `${label}.${browserProblem}`);
}

export function assertScreen(screen: Screen, scope: AppMapScope, label: string): void {
  assertEntity(screen, scope, label);
  requiredText(screen.title, `${label}.title`);
  optionalText(screen.description, `${label}.description`);
  if (screen.logicalStateBinding !== undefined) {
    assertReviewedBinding(
      screen.logicalStateBinding,
      "logicalStateId",
      `${label}.logicalStateBinding`,
    );
  }
  if (screen.handoff !== undefined) {
    objectValue(screen.handoff, `${label}.handoff`);
    requiredText(screen.handoff.ownerApp, `${label}.handoff.ownerApp`, 240);
    if (
      screen.handoff.returnAction !== "back" &&
      screen.handoff.returnAction !== "relaunch-source"
    ) {
      appMapFail("invalid-map", `${label}.handoff.returnAction is unsupported`);
    }
  }
  if (screen.identity) assertIdentity(screen.identity, `${label}.identity`);
  if (
    screen.evidenceSurface !== undefined &&
    !["ordinary", "modal", "preview", "confirmation", "dead-end"].includes(screen.evidenceSurface)
  ) {
    appMapFail("invalid-map", `${label}.evidenceSurface is unsupported`);
  }
  if (screen.position) {
    if (!Number.isFinite(screen.position.x) || !Number.isFinite(screen.position.y)) {
      appMapFail("invalid-map", `${label}.position must contain finite coordinates`);
    }
  }
  stringArray(screen.variantIds, `${label}.variantIds`);
  if (screen.consolidations !== undefined) {
    if (!Array.isArray(screen.consolidations))
      appMapFail("invalid-map", `${label}.consolidations must be an array`);
    for (const [index, record] of screen.consolidations.entries()) {
      objectValue(record, `${label}.consolidations[${index}]`);
      identifier(record.eventId, `${label}.consolidations[${index}].eventId`);
      identifier(record.actorId, `${label}.consolidations[${index}].actorId`);
      finiteTimestamp(record.at, `${label}.consolidations[${index}].at`);
      if (
        !Array.isArray(record.sourceScreens) ||
        !Array.isArray(record.sourceVariants) ||
        !Array.isArray(record.internalConnections)
      ) {
        appMapFail(
          "invalid-map",
          `${label}.consolidations[${index}] must retain screens, variants, and internal connections`,
        );
      }
      objectValue(record.preview, `${label}.consolidations[${index}].preview`);
    }
  }
}

export function assertAppMapNote(note: AppMapNote, scope: AppMapScope, label: string): void {
  assertEntity(note, scope, label);
  requiredText(note.text, `${label}.text`, 480);
  if (!Number.isFinite(note.position.x) || !Number.isFinite(note.position.y)) {
    appMapFail("invalid-map", `${label}.position must contain finite coordinates`);
  }
}

export function assertMapGroup(group: MapGroup, scope: AppMapScope, label: string): void {
  assertEntity(group, scope, label);
  requiredText(group.name, `${label}.name`, 120);
  stringArray(group.screenIds, `${label}.screenIds`);
  if (group.screenIds.length === 0) {
    appMapFail("invalid-map", `${label}.screenIds must contain at least one screen`);
  }
  if (new Set(group.screenIds).size !== group.screenIds.length) {
    appMapFail("duplicate-id", `${label}.screenIds contains a duplicate screen`);
  }
}

function assertBaseline(value: BaselineProvenance, label: string): void {
  objectValue(value, label);
  finiteTimestamp(value.approvedAt, `${label}.approvedAt`);
  identifier(value.approvedBy, `${label}.approvedBy`);
  objectValue(value.source, `${label}.source`);
  if (value.source.kind === "run") {
    identifier(value.source.targetResultId, `${label}.source.targetResultId`);
    if (value.source.evidenceId !== undefined)
      identifier(value.source.evidenceId, `${label}.source.evidenceId`);
  } else if (value.source.kind === "recording") {
    identifier(value.source.takeId, `${label}.source.takeId`);
    safeInteger(value.source.takeRevision, `${label}.source.takeRevision`);
    if (value.source.takeRevision === 0)
      appMapFail("invalid-map", `${label}.source.takeRevision must be positive`);
    stringArray(value.source.evidenceIds, `${label}.source.evidenceIds`);
  } else if (value.source.kind === "manual") {
    stringArray(value.source.evidenceIds, `${label}.source.evidenceIds`);
    if (value.source.evidenceIds.length === 0)
      appMapFail("invalid-map", `${label}.source.evidenceIds must not be empty`);
  } else appMapFail("invalid-map", `${label}.source.kind is unsupported`);
}

export function assertVariant(variant: ScreenVariant, scope: AppMapScope, label: string): void {
  assertEntity(variant, scope, label);
  identifier(variant.screenId, `${label}.screenId`);
  assertTargetProfile(variant.targetProfile, `${label}.targetProfile`);
  if (variant.observation) assertObservation(variant.observation, `${label}.observation`);
  stringArray(variant.evidenceIds, `${label}.evidenceIds`);
  if (variant.evidenceUris !== undefined) {
    if (!Array.isArray(variant.evidenceUris))
      appMapFail("invalid-map", `${label}.evidenceUris must be an array`);
    const seen = new Set<string>();
    variant.evidenceUris.forEach((uri, index) => {
      requiredText(uri, `${label}.evidenceUris[${index}]`, 2_048);
      if (!uri.startsWith("relay-evidence://")) {
        appMapFail(
          "invalid-map",
          `${label}.evidenceUris[${index}] must be a Relay evidence resource`,
        );
      }
      if (seen.has(uri)) appMapFail("duplicate-id", `${label}.evidenceUris contains a duplicate`);
      seen.add(uri);
    });
  }
  if (variant.screenshotUri !== undefined) {
    requiredText(variant.screenshotUri, `${label}.screenshotUri`, 2_048);
    if (!variant.screenshotUri.startsWith("relay-evidence://")) {
      appMapFail("invalid-map", `${label}.screenshotUri must be a Relay evidence resource`);
    }
    if (!variant.evidenceUris?.includes(variant.screenshotUri)) {
      appMapFail("invalid-map", `${label}.screenshotUri must be included in evidenceUris`);
    }
  }
  if (variant.rawAccessibilityTree !== undefined) {
    const raw = variant.rawAccessibilityTree;
    identifier(raw.id, `${label}.rawAccessibilityTree.id`);
    requiredText(raw.uri, `${label}.rawAccessibilityTree.uri`, 2_048);
    if (!raw.uri.startsWith("relay-evidence://") || !/^[a-f0-9]{64}$/u.test(raw.sha256)) {
      appMapFail("invalid-map", `${label}.rawAccessibilityTree must be immutable Relay evidence`);
    }
    if (raw.mime !== "application/json" || !Number.isSafeInteger(raw.bytes) || raw.bytes <= 0) {
      appMapFail(
        "invalid-map",
        `${label}.rawAccessibilityTree must describe a non-empty JSON tree`,
      );
    }
    if (raw.uri !== `relay-evidence://${raw.sha256}`) {
      appMapFail("invalid-map", `${label}.rawAccessibilityTree.uri must match its sha256`);
    }
    if (!variant.evidenceIds.includes(raw.id) || !variant.evidenceUris?.includes(raw.uri)) {
      appMapFail("invalid-map", `${label}.rawAccessibilityTree must belong to the variant`);
    }
    const hasObservationBinding = raw.observationId !== undefined;
    const hasCapturedAt = raw.capturedAt !== undefined;
    if (hasObservationBinding !== hasCapturedAt) {
      appMapFail(
        "invalid-map",
        `${label}.rawAccessibilityTree observation provenance must include both observationId and capturedAt`,
      );
    }
    if (hasObservationBinding)
      identifier(raw.observationId, `${label}.rawAccessibilityTree.observationId`);
    if (hasCapturedAt) finiteTimestamp(raw.capturedAt, `${label}.rawAccessibilityTree.capturedAt`);
  }
  if (variant.scrollSurfaces !== undefined) {
    if (!Array.isArray(variant.scrollSurfaces)) {
      appMapFail("invalid-map", `${label}.scrollSurfaces must be an array`);
    }
    const surfaceIds = new Set<string>();
    variant.scrollSurfaces.forEach((surface, index) => {
      assertLogicalScrollSurface(surface, variant, `${label}.scrollSurfaces[${index}]`);
      if (surfaceIds.has(surface.captureId)) {
        appMapFail(
          "duplicate-id",
          `${label}.scrollSurfaces contains duplicate ${surface.captureId}`,
        );
      }
      surfaceIds.add(surface.captureId);
    });
  }
  if (variant.scrollCapturePolicy !== undefined) {
    assertScrollSurfaceCapturePolicy(variant.scrollCapturePolicy, `${label}.scrollCapturePolicy`);
  }
  if (variant.refreshCapture !== undefined) {
    identifier(variant.refreshCapture.captureId, `${label}.refreshCapture.captureId`);
    finiteTimestamp(variant.refreshCapture.capturedAt, `${label}.refreshCapture.capturedAt`);
  }
  if (variant.captureProvenance !== undefined) {
    const provenance = variant.captureProvenance;
    if (provenance.kind !== "run")
      appMapFail("invalid-map", `${label}.captureProvenance.kind is unsupported`);
    identifier(provenance.runId, `${label}.captureProvenance.runId`);
    finiteTimestamp(provenance.capturedAt, `${label}.captureProvenance.capturedAt`);
    if (provenance.locale !== undefined)
      requiredText(provenance.locale, `${label}.captureProvenance.locale`, 128);
    identifier(provenance.screenshotEvidenceId, `${label}.captureProvenance.screenshotEvidenceId`);
    if (provenance.accessibilityEvidenceId !== undefined)
      identifier(
        provenance.accessibilityEvidenceId,
        `${label}.captureProvenance.accessibilityEvidenceId`,
      );
  }
  if (variant.baseline) assertBaseline(variant.baseline, `${label}.baseline`);
}

function assertConnectionPresentation(presentation: ConnectionPresentation, label: string): void {
  objectValue(presentation, label);
  if (
    presentation.route !== undefined &&
    presentation.route !== "elbow" &&
    presentation.route !== "curve" &&
    presentation.route !== "straight"
  ) {
    appMapFail("invalid-map", `${label}.route is unsupported`);
  }
  if (
    presentation.strokeWidth !== undefined &&
    presentation.strokeWidth !== 1 &&
    presentation.strokeWidth !== 2 &&
    presentation.strokeWidth !== 3
  ) {
    appMapFail("invalid-map", `${label}.strokeWidth must be 1, 2, or 3`);
  }
  if (
    presentation.arrow !== undefined &&
    presentation.arrow !== "start" &&
    presentation.arrow !== "end" &&
    presentation.arrow !== "both" &&
    presentation.arrow !== "none"
  ) {
    appMapFail("invalid-map", `${label}.arrow is unsupported`);
  }
  for (const [key, port] of [
    ["sourcePort", presentation.sourcePort],
    ["targetPort", presentation.targetPort],
  ] as const) {
    if (
      port !== undefined &&
      port !== "auto" &&
      port !== "left" &&
      port !== "right" &&
      port !== "top" &&
      port !== "bottom"
    ) {
      appMapFail("invalid-map", `${label}.${key} is unsupported`);
    }
  }
  for (const [key, offset] of [
    ["sourceOffset", presentation.sourceOffset],
    ["targetOffset", presentation.targetOffset],
  ] as const) {
    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0 || offset > 1)) {
      appMapFail("invalid-map", `${label}.${key} must be between 0 and 1`);
    }
  }
  if (presentation.controlOffset !== undefined) {
    objectValue(presentation.controlOffset, `${label}.controlOffset`);
    if (
      !Number.isFinite(presentation.controlOffset.x) ||
      !Number.isFinite(presentation.controlOffset.y)
    ) {
      appMapFail("invalid-map", `${label}.controlOffset must contain finite coordinates`);
    }
  }
}

function assertNormalizedCoordinate(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    appMapFail("invalid-map", `${label} must be a finite coordinate between 0 and 1`);
  }
}

function assertConnectionSourceAnchor(value: unknown, label: string): void {
  const anchor = objectValue(value, label);
  const point = objectValue(anchor.point, `${label}.point`);
  assertNormalizedCoordinate(point.x, `${label}.point.x`);
  assertNormalizedCoordinate(point.y, `${label}.point.y`);
  if (anchor.rect === undefined) return;

  const rect = objectValue(anchor.rect, `${label}.rect`);
  const x = rect.x;
  const y = rect.y;
  const width = rect.width;
  const height = rect.height;
  assertNormalizedCoordinate(x, `${label}.rect.x`);
  assertNormalizedCoordinate(y, `${label}.rect.y`);
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 1) {
    appMapFail("invalid-map", `${label}.rect.width must be between 0 and 1`);
  }
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0 || height > 1) {
    appMapFail("invalid-map", `${label}.rect.height must be between 0 and 1`);
  }
  if (x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) {
    appMapFail("invalid-map", `${label}.rect must remain within the normalized viewport`);
  }
}

export function assertConnection(connection: Connection, scope: AppMapScope, label: string): void {
  assertEntity(connection, scope, label);
  identifier(connection.fromScreenId, `${label}.fromScreenId`);
  objectValue(connection.destination, `${label}.destination`);
  if (connection.destination.kind === "screen")
    identifier(connection.destination.screenId, `${label}.destination.screenId`);
  else if (connection.destination.kind !== "end")
    appMapFail("invalid-map", `${label}.destination.kind is unsupported`);
  optionalText(connection.label, `${label}.label`);
  if (
    connection.coverage !== undefined &&
    connection.coverage !== "inspect" &&
    connection.coverage !== "transition"
  ) {
    appMapFail("invalid-map", `${label}.coverage is unsupported`);
  }
  if (connection.actionIntentBinding !== undefined) {
    assertReviewedBinding(
      connection.actionIntentBinding,
      "intentId",
      `${label}.actionIntentBinding`,
    );
  }
  if (connection.caseStackId !== undefined)
    identifier(connection.caseStackId, `${label}.caseStackId`);
  if (!(connection.state === "draft" || connection.state === "ready"))
    appMapFail("invalid-map", `${label}.state is unsupported`);
  assertActions(connection.actions, `${label}.actions`);
  if (connection.navigation !== undefined)
    assertConnectionNavigation(connection.navigation, `${label}.navigation`);
  if (connection.return !== undefined) {
    assertConnectionReturn(connection.return, `${label}.return`);
  }
  if (connection.sourceAnchor !== undefined)
    assertConnectionSourceAnchor(connection.sourceAnchor, `${label}.sourceAnchor`);
  if (connection.recordingSource !== undefined) {
    const source = connection.recordingSource;
    objectValue(source, `${label}.recordingSource`);
    if (source.schemaVersion !== 1)
      appMapFail("invalid-map", `${label}.recordingSource.schemaVersion must be 1`);
    identifier(source.takeId, `${label}.recordingSource.takeId`);
    safeInteger(source.takeRevision, `${label}.recordingSource.takeRevision`);
    if (source.takeRevision === 0)
      appMapFail("invalid-map", `${label}.recordingSource.takeRevision must be positive`);
    try {
      parseAuthoringCaptureReview(source.capture);
    } catch (error) {
      appMapFail(
        "invalid-map",
        `${label}.recordingSource.capture is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    stringArray(source.evidenceIds, `${label}.recordingSource.evidenceIds`);
    if (source.evidenceIds.length > 256)
      appMapFail("invalid-map", `${label}.recordingSource.evidenceIds exceeds 256 items`);
    if (source.frames !== undefined) {
      if (!Array.isArray(source.frames) || source.frames.length > 2) {
        appMapFail(
          "invalid-map",
          `${label}.recordingSource.frames must contain at most two endpoints`,
        );
      }
      const roles = new Set<string>();
      for (const frame of source.frames) {
        if (
          !frame ||
          !source.evidenceIds.includes(frame.evidenceId) ||
          typeof frame.uri !== "string" ||
          !/^relay-evidence:\/\/[a-f\d]{64}$/iu.test(frame.uri) ||
          !["before", "after"].includes(frame.role) ||
          roles.has(frame.role)
        ) {
          appMapFail(
            "invalid-map",
            `${label}.recordingSource.frames must reference unique reviewed endpoints`,
          );
        }
        roles.add(frame.role);
      }
    }
    const recorded = connection.actions.filter((action) => action.kind === "recorded");
    const sourceEvidence = new Set(source.evidenceIds);
    const reviewedObservation =
      connection.actions.length === 1 &&
      connection.actions[0]?.kind === "passive" &&
      connection.actions[0].id === `passive-${source.takeId}` &&
      Boolean(source.frames?.length);
    if (
      sourceEvidence.size !== source.evidenceIds.length ||
      (!reviewedObservation &&
        !recorded.some(
          (action) =>
            action.kind === "recorded" &&
            action.takeId === source.takeId &&
            action.takeRevision === source.takeRevision &&
            new Set(action.evidenceIds).size === action.evidenceIds.length &&
            action.evidenceIds.length === source.evidenceIds.length &&
            action.evidenceIds.every((id) => sourceEvidence.has(id)),
        ))
    ) {
      appMapFail("invalid-map", `${label}.recordingSource must match its recorded action evidence`);
    }
  }
  if (connection.presentation !== undefined)
    assertConnectionPresentation(connection.presentation, `${label}.presentation`);
}

export function assertCaseStack(stack: CaseStack, scope: AppMapScope, label: string): void {
  assertEntity(stack, scope, label);
  requiredText(stack.name, `${label}.name`);
  optionalText(stack.description, `${label}.description`);
  stringArray(stack.dataIds, `${label}.dataIds`);
  if (stack.dataIds.length === 0) {
    appMapFail("invalid-map", `${label}.dataIds must not be empty`);
  }
  if (new Set(stack.dataIds).size !== stack.dataIds.length) {
    appMapFail("duplicate-id", `${label}.dataIds must not contain duplicates`);
  }
  if (
    !(stack.strategy === "zip" || stack.strategy === "cartesian" || stack.strategy === "pairwise")
  ) {
    appMapFail("invalid-map", `${label}.strategy is unsupported`);
  }
  safeInteger(stack.maxCases, `${label}.maxCases`);
  if (stack.maxCases < 1 || stack.maxCases > 250) {
    appMapFail("invalid-map", `${label}.maxCases must be between 1 and 250`);
  }
}

export function assertAppMapTest(work: AppMapTest, scope: AppMapScope, label: string): void {
  assertEntity(work, scope, label);
  requiredText(work.name, `${label}.name`);
  assertScenarioTest(work, label);
}

export function assertAppMapCombine(
  combine: AppMapCombine,
  scope: AppMapScope,
  label: string,
): void {
  assertEntity(combine, scope, label);
  requiredText(combine.name, `${label}.name`);
  stringArray(combine.variableIds, `${label}.variableIds`);
  stringArray(combine.testIds, `${label}.testIds`);
  if (!combine.variableIds.length)
    appMapFail("invalid-map", `${label} needs at least one variable`);
  if (!combine.testIds.length) appMapFail("invalid-map", `${label} needs at least one test`);
  if (combine.selected !== undefined) {
    const selected = objectValue(combine.selected, `${label}.selected`);
    for (const [variableId, optionIds] of Object.entries(selected)) {
      identifier(variableId, `${label}.selected key`);
      stringArray(optionIds, `${label}.selected.${variableId}`);
      if (!(optionIds as string[]).length) {
        appMapFail("invalid-map", `${label}.selected.${variableId} needs at least one value`);
      }
    }
  }
  if (combine.captures !== undefined) {
    const captures = objectValue(combine.captures, `${label}.captures`);
    for (const [testId, value] of Object.entries(captures)) {
      identifier(testId, `${label}.captures key`);
      if (!combine.testIds.includes(testId)) {
        appMapFail("invalid-map", `${label}.captures.${testId} is not a selected test`);
      }
      const capture = objectValue(value, `${label}.captures.${testId}`);
      if (
        !(
          capture.mode === "every-screen" ||
          capture.mode === "checkpoints" ||
          capture.mode === "final-screen" ||
          capture.mode === "failures-only" ||
          capture.mode === "none"
        )
      ) {
        appMapFail("invalid-map", `${label}.captures.${testId}.mode is unsupported`);
      }
      if (capture.mode === "checkpoints") {
        stringArray(capture.screenIds, `${label}.captures.${testId}.screenIds`);
        if (!capture.screenIds.length) {
          appMapFail("invalid-map", `${label}.captures.${testId}.screenIds must contain a screen`);
        }
      } else if (capture.screenIds !== undefined) {
        appMapFail(
          "invalid-map",
          `${label}.captures.${testId}.screenIds is only valid for checkpoints`,
        );
      }
    }
  }
  if (
    combine.strategy !== undefined &&
    combine.strategy !== "zip" &&
    combine.strategy !== "cartesian" &&
    combine.strategy !== "pairwise"
  ) {
    appMapFail("invalid-map", `${label}.strategy is unsupported`);
  }
  assertRepeatPolicy(combine.repeatPolicy, `${label}.repeatPolicy`);
  for (const dimensionId of Object.keys(combine.repeatPolicy?.valueModes ?? {})) {
    if (!combine.variableIds.includes(dimensionId)) {
      appMapFail(
        "invalid-map",
        `${label}.repeatPolicy.valueModes.${dimensionId} describes an unused dimension`,
      );
    }
  }
  if (combine.cellRuntimeProfiles !== undefined) {
    if (!Array.isArray(combine.cellRuntimeProfiles)) {
      appMapFail("invalid-map", `${label}.cellRuntimeProfiles must be an array`);
    }
    combine.cellRuntimeProfiles.forEach((binding, index) => {
      const entry = objectValue(binding, `${label}.cellRuntimeProfiles[${index}]`);
      identifier(entry.testId, `${label}.cellRuntimeProfiles[${index}].testId`);
      identifier(entry.targetProfileId, `${label}.cellRuntimeProfiles[${index}].targetProfileId`);
      if (!combine.testIds.includes(entry.testId as string)) {
        appMapFail(
          "invalid-map",
          `${label}.cellRuntimeProfiles[${index}] binds a Test that is not on this Combine`,
        );
      }
      const values = objectValue(entry.values, `${label}.cellRuntimeProfiles[${index}].values`);
      for (const [variableId, valueId] of Object.entries(values)) {
        identifier(variableId, `${label}.cellRuntimeProfiles[${index}].values key`);
        identifier(valueId, `${label}.cellRuntimeProfiles[${index}].values.${variableId}`);
        if (!combine.variableIds.includes(variableId)) {
          appMapFail(
            "invalid-map",
            `${label}.cellRuntimeProfiles[${index}] binds unused Variable ${variableId}`,
          );
        }
      }
    });
  }
}

export function assertConnectionPatch(patch: ConnectionPatch, label: string): void {
  objectValue(patch, label);
  if (patch.fromScreenId !== undefined) identifier(patch.fromScreenId, `${label}.fromScreenId`);
  if (patch.destination !== undefined) {
    objectValue(patch.destination, `${label}.destination`);
    if (patch.destination.kind === "screen")
      identifier(patch.destination.screenId, `${label}.destination.screenId`);
    else if (patch.destination.kind !== "end")
      appMapFail("invalid-map", `${label}.destination.kind is unsupported`);
  }
  if (patch.label !== undefined && patch.label !== null)
    requiredText(patch.label, `${label}.label`);
  if (
    patch.coverage !== undefined &&
    patch.coverage !== null &&
    patch.coverage !== "inspect" &&
    patch.coverage !== "transition"
  ) {
    appMapFail("invalid-map", `${label}.coverage is unsupported`);
  }
  if (patch.actionIntentBinding !== undefined && patch.actionIntentBinding !== null) {
    assertReviewedBinding(patch.actionIntentBinding, "intentId", `${label}.actionIntentBinding`);
  }
  if (patch.caseStackId !== undefined && patch.caseStackId !== null)
    identifier(patch.caseStackId, `${label}.caseStackId`);
  if (patch.state !== undefined && patch.state !== "draft" && patch.state !== "ready")
    appMapFail("invalid-map", `${label}.state is unsupported`);
  if (patch.actions !== undefined) assertActions(patch.actions, `${label}.actions`);
  if (patch.navigation !== undefined && patch.navigation !== null)
    assertConnectionNavigation(patch.navigation, `${label}.navigation`);
  if (patch.return !== undefined && patch.return !== null) {
    assertConnectionReturn(patch.return, `${label}.return`);
  }
  if (patch.sourceAnchor !== undefined && patch.sourceAnchor !== null)
    assertConnectionSourceAnchor(patch.sourceAnchor, `${label}.sourceAnchor`);
  if (patch.presentation !== undefined && patch.presentation !== null)
    assertConnectionPresentation(patch.presentation, `${label}.presentation`);
}

export function assertAddScreenInput(
  input: AddScreenInput,
  scope: AppMapScope,
  label: string,
): void {
  objectValue(input, label);
  assertScreen(input.screen, scope, `${label}.screen`);
  const variants = input.variants ?? [];
  if (!Array.isArray(variants)) appMapFail("invalid-map", `${label}.variants must be an array`);
  const ids = new Set<string>();
  variants.forEach((variant, index) => {
    assertVariant(variant, scope, `${label}.variants[${index}]`);
    if (variant.screenId !== input.screen.id)
      appMapFail("missing-reference", `${label}.variants[${index}] belongs to another screen`);
    if (ids.has(variant.id))
      appMapFail("duplicate-id", `${label}.variants contains duplicate ${variant.id}`);
    ids.add(variant.id);
  });
  if (input.screen.variantIds.some((variantId) => !ids.has(variantId)))
    appMapFail("missing-reference", `${label}.screen.variantIds must be supplied in variants`);
  if (variants.some((variant) => !input.screen.variantIds.includes(variant.id)))
    appMapFail("missing-reference", `${label}.variants must be referenced by screen.variantIds`);
}

export function assertUpdateScreenInput(
  input: UpdateScreenInput,
  scope: AppMapScope,
  label: string,
): void {
  objectValue(input, label);
  assertScreenPatch(input.patch, `${label}.patch`);
  if (input.upsertVariants !== undefined) {
    if (!Array.isArray(input.upsertVariants))
      appMapFail("invalid-map", `${label}.upsertVariants must be an array`);
    const ids = new Set<string>();
    input.upsertVariants.forEach((variant, index) => {
      assertVariant(variant, scope, `${label}.upsertVariants[${index}]`);
      if (ids.has(variant.id))
        appMapFail("duplicate-id", `${label}.upsertVariants contains duplicate ${variant.id}`);
      ids.add(variant.id);
    });
  }
  if (input.removeVariantIds !== undefined)
    stringArray(input.removeVariantIds, `${label}.removeVariantIds`);
  const removals = new Set(input.removeVariantIds ?? []);
  for (const variant of input.upsertVariants ?? []) {
    if (removals.has(variant.id))
      appMapFail("invalid-map", `${label} cannot upsert and remove variant ${variant.id}`);
  }
}

function assertProposalChange(change: ProposalChange, scope: AppMapScope, label: string): void {
  objectValue(change, label);
  switch (change.kind) {
    case "screen.add":
      assertAddScreenInput(change.input, scope, `${label}.input`);
      break;
    case "screen.update":
      identifier(change.screenId, `${label}.screenId`);
      assertUpdateScreenInput(change.input, scope, `${label}.input`);
      break;
    case "screen.remove":
      identifier(change.screenId, `${label}.screenId`);
      break;
    case "connection.connect":
      assertConnection(change.connection, scope, `${label}.connection`);
      break;
    case "connection.update":
      identifier(change.connectionId, `${label}.connectionId`);
      assertConnectionPatch(change.patch, `${label}.patch`);
      break;
    case "connection.remove":
      identifier(change.connectionId, `${label}.connectionId`);
      break;
    case "group.save":
      assertMapGroup(change.group, scope, `${label}.group`);
      break;
    case "group.remove":
      identifier(change.groupId, `${label}.groupId`);
      break;
    case "test.edit":
      identifier(change.testId, `${label}.testId`);
      if (!Array.isArray(change.edits) || change.edits.length === 0 || change.edits.length > 100) {
        appMapFail("invalid-map", `${label}.edits must contain between 1 and 100 edits`);
      }
      if (change.review !== undefined) {
        objectValue(change.review, `${label}.review`);
        for (const side of ["before", "after"] as const) {
          const value = change.review[side];
          objectValue(value, `${label}.review.${side}`);
          requiredText(value.name, `${label}.review.${side}.name`);
          for (const count of ["stepCount", "resolvedStepCount", "unresolvedStepCount"] as const) {
            safeInteger(value[count], `${label}.review.${side}.${count}`);
          }
          if (value.resolvedStepCount + value.unresolvedStepCount !== value.stepCount) {
            appMapFail("invalid-map", `${label}.review.${side} step counts are inconsistent`);
          }
        }
        if (
          !Array.isArray(change.review.edits) ||
          change.review.edits.length !== change.edits.length
        ) {
          appMapFail("invalid-map", `${label}.review.edits must describe every edit`);
        }
        change.review.edits.forEach((edit, index) => {
          objectValue(edit, `${label}.review.edits[${index}]`);
          requiredText(edit.kind, `${label}.review.edits[${index}].kind`);
          requiredText(edit.summary, `${label}.review.edits[${index}].summary`);
          if (edit.stepId !== undefined)
            identifier(edit.stepId, `${label}.review.edits[${index}].stepId`);
        });
      }
      break;
    default:
      appMapFail("invalid-map", `${label}.kind is unsupported`);
  }
}

export function assertProposal(proposal: Proposal, scope: AppMapScope, label: string): void {
  assertEntity(proposal, scope, label);
  requiredText(proposal.title, `${label}.title`);
  optionalText(proposal.description, `${label}.description`);
  if (
    !(
      proposal.status === "pending" ||
      proposal.status === "approved" ||
      proposal.status === "rejected"
    )
  )
    appMapFail("invalid-map", `${label}.status is unsupported`);
  safeInteger(proposal.baseRevision, `${label}.baseRevision`);
  if (proposal.sourceRevision !== undefined) {
    safeInteger(proposal.sourceRevision, `${label}.sourceRevision`);
    if (proposal.sourceRevision >= proposal.baseRevision) {
      appMapFail("invalid-map", `${label}.sourceRevision must precede baseRevision`);
    }
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0)
    appMapFail("invalid-map", `${label}.changes must contain at least one change`);
  proposal.changes.forEach((change, index) =>
    assertProposalChange(change, scope, `${label}.changes[${index}]`),
  );
  if (proposal.repair !== undefined) {
    assertProposalRepair(proposal.repair, scope, `${label}.repair`, assertProposalChange);
  }
  if (proposal.status === "pending" && proposal.decision !== undefined)
    appMapFail("proposal-state", `${label} is pending but already has a decision`);
  if (proposal.status !== "pending" && !proposal.decision)
    appMapFail("proposal-state", `${label} is decided but has no decision metadata`);
  if (proposal.decision) {
    identifier(proposal.decision.actorId, `${label}.decision.actorId`);
    finiteTimestamp(proposal.decision.at, `${label}.decision.at`);
    optionalText(proposal.decision.reason, `${label}.decision.reason`);
  }
}
