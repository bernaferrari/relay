import type { ScreenIdentity, TargetProfile } from "@relay/protocol";
import { appMapFail } from "./errors.js";
import type {
  ActivityEvent,
  AddScreenInput,
  AppMapEntity,
  AppMapScope,
  BaselineProvenance,
  CaseStack,
  Connection,
  ConnectionPatch,
  Flow,
  Proposal,
  ProposalChange,
  Routine,
  RunReference,
  Screen,
  ScreenPatch,
  ScreenVariant,
  TargetResultReference,
  UpdateScreenInput,
} from "./model.js";
import type { ScreenIdentityObservation } from "../screen-identity.js";
import { assertActions } from "./action-validation.js";
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

function assertScope(value: AppMapScope, scope: AppMapScope, label: string): void {
  if (
    value.organizationId !== scope.organizationId ||
    value.projectId !== scope.projectId ||
    value.appMapId !== scope.appMapId
  ) {
    appMapFail("scope-mismatch", `${label} does not belong to this App Map project scope`);
  }
}

function assertEntity(value: AppMapEntity, scope: AppMapScope, label: string): void {
  identifier(value.id, `${label}.id`);
  identifier(value.organizationId, `${label}.organizationId`);
  identifier(value.projectId, `${label}.projectId`);
  identifier(value.appMapId, `${label}.appMapId`);
  assertScope(value, scope, label);
  finiteTimestamp(value.createdAt, `${label}.createdAt`);
  finiteTimestamp(value.updatedAt, `${label}.updatedAt`);
  if (value.updatedAt < value.createdAt) {
    appMapFail("invalid-map", `${label}.updatedAt cannot precede createdAt`);
  }
}

function assertIdentity(value: ScreenIdentity, label: string): void {
  if (value.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(value.fingerprint)) {
    appMapFail("invalid-map", `${label} must contain a schema-v1 SHA-256 fingerprint`);
  }
  if (value.aliases !== undefined) {
    stringArray(value.aliases, `${label}.aliases`);
    if (value.aliases.some((alias) => !/^[a-f0-9]{64}$/u.test(alias))) {
      appMapFail("invalid-map", `${label}.aliases must contain SHA-256 fingerprints`);
    }
  }
}

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

function assertTargetProfile(value: TargetProfile, label: string): void {
  objectValue(value, label);
  identifier(value.id, `${label}.id`);
  identifier(value.targetId, `${label}.targetId`);
  if (!(value.source === "device" || value.source === "browser")) {
    appMapFail("invalid-map", `${label}.source is unsupported`);
  }
  if (!(value.platform === "android" || value.platform === "ios" || value.platform === "browser")) {
    appMapFail("invalid-map", `${label}.platform is unsupported`);
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
}

export function assertScreen(screen: Screen, scope: AppMapScope, label: string): void {
  assertEntity(screen, scope, label);
  requiredText(screen.title, `${label}.title`);
  optionalText(screen.description, `${label}.description`);
  if (screen.identity) assertIdentity(screen.identity, `${label}.identity`);
  if (screen.position) {
    if (!Number.isFinite(screen.position.x) || !Number.isFinite(screen.position.y)) {
      appMapFail("invalid-map", `${label}.position must contain finite coordinates`);
    }
  }
  stringArray(screen.variantIds, `${label}.variantIds`);
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
  if (variant.baseline) assertBaseline(variant.baseline, `${label}.baseline`);
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
  if (connection.caseStackId !== undefined)
    identifier(connection.caseStackId, `${label}.caseStackId`);
  if (!(connection.state === "draft" || connection.state === "ready"))
    appMapFail("invalid-map", `${label}.state is unsupported`);
  assertActions(connection.actions, `${label}.actions`);
}

export function assertCaseStack(stack: CaseStack, scope: AppMapScope, label: string): void {
  assertEntity(stack, scope, label);
  requiredText(stack.name, `${label}.name`);
  optionalText(stack.description, `${label}.description`);
  stringArray(stack.variableIds, `${label}.variableIds`);
  if (stack.variableIds.length === 0) {
    appMapFail("invalid-map", `${label}.variableIds must not be empty`);
  }
  if (new Set(stack.variableIds).size !== stack.variableIds.length) {
    appMapFail("duplicate-id", `${label}.variableIds must not contain duplicates`);
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

export function assertRoutine(routine: Routine, scope: AppMapScope, label: string): void {
  assertEntity(routine, scope, label);
  requiredText(routine.name, `${label}.name`);
  optionalText(routine.description, `${label}.description`);
  if (!Array.isArray(routine.parameters))
    appMapFail("invalid-map", `${label}.parameters must be an array`);
  const names = new Set<string>();
  routine.parameters.forEach((parameter, index) => {
    objectValue(parameter, `${label}.parameters[${index}]`);
    identifier(parameter.name, `${label}.parameters[${index}].name`);
    if (names.has(parameter.name))
      appMapFail("duplicate-id", `${label} contains duplicate parameter ${parameter.name}`);
    names.add(parameter.name);
    optionalText(parameter.label, `${label}.parameters[${index}].label`);
    optionalText(parameter.description, `${label}.parameters[${index}].description`);
    if (parameter.default !== undefined && typeof parameter.default !== "string")
      appMapFail("invalid-map", `${label}.parameters[${index}].default must be a string`);
    if (parameter.required !== undefined && typeof parameter.required !== "boolean")
      appMapFail("invalid-map", `${label}.parameters[${index}].required must be boolean`);
  });
  assertActions(routine.actions, `${label}.actions`);
}

export function assertFlow(flow: Flow, scope: AppMapScope, label: string): void {
  assertEntity(flow, scope, label);
  requiredText(flow.name, `${label}.name`);
  identifier(flow.startScreenId, `${label}.startScreenId`);
  stringArray(flow.connectionIds, `${label}.connectionIds`);
}

export function assertRun(run: RunReference, scope: AppMapScope, label: string): void {
  assertEntity(run, scope, label);
  if (run.flowId !== undefined) identifier(run.flowId, `${label}.flowId`);
  safeInteger(run.appMapRevision, `${label}.appMapRevision`);
  stringArray(run.targetResultIds, `${label}.targetResultIds`);
  finiteTimestamp(run.startedAt, `${label}.startedAt`);
  if (run.finishedAt !== undefined) {
    finiteTimestamp(run.finishedAt, `${label}.finishedAt`);
    if (run.finishedAt < run.startedAt)
      appMapFail("invalid-map", `${label}.finishedAt cannot precede startedAt`);
  }
}

export function assertTargetResult(
  result: TargetResultReference,
  scope: AppMapScope,
  label: string,
): void {
  assertEntity(result, scope, label);
  identifier(result.runId, `${label}.runId`);
  assertTargetProfile(result.targetProfile, `${label}.targetProfile`);
  if (
    !(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"] as const).includes(
      result.outcome,
    )
  )
    appMapFail("invalid-map", `${label}.outcome is unsupported`);
  if (result.connectionId !== undefined) identifier(result.connectionId, `${label}.connectionId`);
  stringArray(result.evidenceIds, `${label}.evidenceIds`);
  if (result.finishedAt !== undefined) finiteTimestamp(result.finishedAt, `${label}.finishedAt`);
}

export function assertScreenPatch(patch: ScreenPatch, label: string): void {
  objectValue(patch, label);
  if (patch.title !== undefined) requiredText(patch.title, `${label}.title`);
  if (patch.description !== undefined && patch.description !== null)
    requiredText(patch.description, `${label}.description`);
  if (patch.identity !== undefined && patch.identity !== null)
    assertIdentity(patch.identity, `${label}.identity`);
  if (
    patch.position !== undefined &&
    patch.position !== null &&
    (!Number.isFinite(patch.position.x) || !Number.isFinite(patch.position.y))
  ) {
    appMapFail("invalid-map", `${label}.position must contain finite coordinates`);
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
  if (patch.caseStackId !== undefined && patch.caseStackId !== null)
    identifier(patch.caseStackId, `${label}.caseStackId`);
  if (patch.state !== undefined && patch.state !== "draft" && patch.state !== "ready")
    appMapFail("invalid-map", `${label}.state is unsupported`);
  if (patch.actions !== undefined) assertActions(patch.actions, `${label}.actions`);
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
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0)
    appMapFail("invalid-map", `${label}.changes must contain at least one change`);
  proposal.changes.forEach((change, index) =>
    assertProposalChange(change, scope, `${label}.changes[${index}]`),
  );
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

export function assertActivity(
  event: ActivityEvent,
  scope: AppMapScope,
  label: string,
  mapRevision: number,
): void {
  identifier(event.id, `${label}.id`);
  identifier(event.organizationId, `${label}.organizationId`);
  identifier(event.projectId, `${label}.projectId`);
  identifier(event.appMapId, `${label}.appMapId`);
  assertScope(event, scope, label);
  identifier(event.actorId, `${label}.actorId`);
  if (!(event.actorKind === "human" || event.actorKind === "agent" || event.actorKind === "system"))
    appMapFail("invalid-map", `${label}.actorKind is unsupported`);
  const eventTypes: ActivityEvent["eventType"][] = [
    "app-map.updated",
    "screen.added",
    "screen.updated",
    "screen.removed",
    "connection.connected",
    "connection.updated",
    "connection.removed",
    "flow.saved",
    "flow.removed",
    "routine.saved",
    "routine.removed",
    "case-stack.saved",
    "case-stack.attached",
    "case-stack.removed",
    "recording.committed",
    "proposal.submitted",
    "proposal.approved",
    "proposal.rejected",
  ];
  if (!eventTypes.includes(event.eventType))
    appMapFail("invalid-map", `${label}.eventType is unsupported`);
  objectValue(event.subject, `${label}.subject`);
  if (
    !(
      event.subject.kind === "app-map" ||
      event.subject.kind === "screen" ||
      event.subject.kind === "connection" ||
      event.subject.kind === "flow" ||
      event.subject.kind === "routine" ||
      event.subject.kind === "case-stack" ||
      event.subject.kind === "proposal"
    )
  )
    appMapFail("invalid-map", `${label}.subject.kind is unsupported`);
  identifier(event.subject.id, `${label}.subject.id`);
  requiredText(event.summary, `${label}.summary`, 240);
  finiteTimestamp(event.at, `${label}.at`);
  safeInteger(event.beforeRevision, `${label}.beforeRevision`);
  safeInteger(event.afterRevision, `${label}.afterRevision`);
  if (event.afterRevision !== event.beforeRevision + 1 || event.afterRevision > mapRevision)
    appMapFail("invalid-map", `${label} has an invalid revision transition`);
}
