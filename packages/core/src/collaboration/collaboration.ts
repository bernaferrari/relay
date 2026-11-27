import {
  RevisionConflict,
  type AppMap,
  type Build,
  type CompatibilityMatrix,
  type DevicePool,
  type Project,
  type ProjectVariablesWrite,
  type ResourceEvent,
  type RevisionWrite,
  type Revisioned,
  type TestData,
} from "@relay/protocol";
import { randomUUID } from "node:crypto";
import { now, publish } from "./events.js";
import { APP_MAP_SCHEMA_VERSION, validateAppMap } from "../app-map/app-map.js";
import { rescopeAppMap } from "../app-map/app-map-yaml.js";
import { validateDevicePool } from "../device/device-pool.js";
import { currentOperationContext } from "../execution/operation-context.js";
import { assertWebBuildProviderReceipt } from "../change/web-build-verification.js";
import { assertAppMapInputDataSetChanges } from "../input/input-data-set.js";
import {
  mergeProjectVariableUpdate,
  assertUnlinkedProjectInputs,
  validateProjectInputIds,
  validateProjectVariables,
} from "../input/project-variable-update.js";
import {
  readControlStore,
  withControlStore,
  type AppMapRecoveryDocument,
  type ControlStore,
  type DegradedAppMap,
} from "./collaboration-store.js";
import { appMapKey } from "./collaboration-app-map-key.js";

export {
  collaborationStateRoot,
  listDurableControlEvents,
  recoverCollaborationState,
  type AppMapRecoveryDocument,
  type ControlStore,
  type DegradedAppMap,
} from "./collaboration-store.js";
export {
  CONTROL_DB_NAME,
  CONTROL_SCHEMA_VERSION,
  controlDatabasePath,
  resetControlDatabaseCache,
} from "./collaboration-db.js";
export {
  DEVICE_LEASE_RENEW_UNDER_MS,
  DEVICE_LEASE_TTL_MS,
  isDeviceLeaseClaimActive,
  isDeviceLeaseSessionActive,
  leaseDevice,
  listDeviceLeases,
  releaseDeviceLease,
  renewDeviceLease,
  takeOverDeviceLease,
} from "./collaboration-device-leases.js";
export { writeStoredAppMapObservation } from "./collaboration-observations.js";

function emit(event: ResourceEvent): void {
  publish(event);
}

function revisioned<T>(value: T): Revisioned<T> {
  return { revision: 0, value, updatedAt: now() };
}

function writeRevision<T>(current: Revisioned<T>, write: RevisionWrite<T>): Revisioned<T> {
  if (current.revision !== write.expectedRevision) throw new RevisionConflict(current);
  return {
    revision: current.revision + 1,
    value: write.value,
    updatedAt: now(),
    updatedBy: write.actorId,
  };
}

type BuildRegistrationInput = Omit<Build, "createdAt" | "updatedAt">;

function isLoopbackDevelopmentUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value?.trim() ?? "");
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function assertWebBuildRegistrationTrust(input: BuildRegistrationInput): BuildRegistrationInput {
  if (input.platform !== "web") return input;

  const mode =
    input.webDeploymentMode ?? (input.webProviderReceipt ? "provider-verified" : undefined);
  if (mode === "self-managed") {
    if (!isLoopbackDevelopmentUrl(input.sourceUrl)) {
      throw new Error("Self-managed web builds require a loopback development URL");
    }
    if (
      input.sourceSha !== undefined ||
      input.deploymentDigest !== undefined ||
      input.webProviderReceipt !== undefined
    ) {
      throw new Error(
        "Self-managed web builds cannot claim provider sourceSha or deploymentDigest",
      );
    }
    return input;
  }

  if (mode !== "provider-verified" || !input.webProviderReceipt) {
    throw new Error("Provider-verified web builds require an exact signed provider receipt");
  }
  assertWebBuildProviderReceipt(input.webProviderReceipt);
  if (input.webProviderReceipt.deploymentId !== input.id) {
    throw new Error("Web build id does not match the signed provider deployment id");
  }
  const trusted = {
    ...input,
    sourceUrl: input.sourceUrl ?? input.webProviderReceipt.sourceUrl,
    sourceSha: input.sourceSha ?? input.webProviderReceipt.sourceSha,
    deploymentDigest: input.deploymentDigest ?? input.webProviderReceipt.deploymentDigest,
    configuration: input.configuration ?? input.webProviderReceipt.configuration,
    environmentRevision: input.environmentRevision ?? input.webProviderReceipt.environmentRevision,
    webDeploymentMode: "provider-verified" as const,
  };
  assertWebBuildProviderReceipt(input.webProviderReceipt, trusted);
  return trusted;
}

export async function listProjects(organizationId = "local"): Promise<Project[]> {
  return (await readControlStore((store) => store.projects())).filter(
    (project) => project.organizationId === organizationId,
  );
}

export async function saveProject(
  input: Pick<Project, "id" | "organizationId" | "name">,
): Promise<Project> {
  return withControlStore((store) => {
    const at = now();
    const existing = store.projects().find((item) => item.id === input.id);
    const project: Project = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
    store.upsertProject(project);
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at,
      projectId: project.id,
      resource: "project",
      resourceId: project.id,
    });
    return project;
  });
}

export async function listBuilds(projectId: string): Promise<Build[]> {
  return readControlStore((store) => store.builds(projectId));
}

export async function readBuild(projectId: string, id: string): Promise<Build | null> {
  return (await listBuilds(projectId)).find((item) => item.id === id) ?? null;
}

export async function saveBuild(input: BuildRegistrationInput): Promise<Build> {
  const trustedInput = assertWebBuildRegistrationTrust(input);
  return withControlStore((store) => {
    const at = now();
    const existing = store
      .builds(trustedInput.projectId)
      .find((item) => item.projectId === trustedInput.projectId && item.id === trustedInput.id);
    const build = { ...trustedInput, createdAt: existing?.createdAt ?? at, updatedAt: at };
    store.upsertBuild(build);
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at,
      projectId: trustedInput.projectId,
      resource: "build",
      resourceId: trustedInput.id,
    });
    return build;
  });
}

/** Persist one reviewed Build set in a single ControlStore transaction. */
export async function saveBuilds(inputs: readonly BuildRegistrationInput[]): Promise<Build[]> {
  const trustedInputs = inputs.map(assertWebBuildRegistrationTrust);
  return withControlStore((store) => {
    const at = now();
    return trustedInputs.map((input) => {
      const existing = store
        .builds(input.projectId)
        .find((item) => item.projectId === input.projectId && item.id === input.id);
      const build = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
      store.upsertBuild(build);
      emit({
        type: existing ? "resource.updated" : "resource.created",
        at,
        projectId: input.projectId,
        resource: "build",
        resourceId: input.id,
      });
      return build;
    });
  });
}

export async function listDevicePools(projectId: string): Promise<DevicePool[]> {
  return readControlStore((store) => store.pools(projectId));
}

export async function readDevicePool(projectId: string, id: string): Promise<DevicePool | null> {
  return (await listDevicePools(projectId)).find((item) => item.id === id) ?? null;
}

export async function saveDevicePool(
  input: Omit<DevicePool, "createdAt" | "updatedAt">,
): Promise<DevicePool> {
  validateDevicePool(input);
  return withControlStore((store) => {
    const at = now();
    const existing = store
      .pools(input.projectId)
      .find((item) => item.projectId === input.projectId && item.id === input.id);
    const pool = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
    store.upsertPool(pool);
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at,
      projectId: input.projectId,
      resource: "device-pool",
      resourceId: input.id,
    });
    return pool;
  });
}

export async function listCompatibilityMatrices(projectId: string): Promise<CompatibilityMatrix[]> {
  return readControlStore((store) => store.matrices(projectId));
}

export async function readCompatibilityMatrix(
  projectId: string,
  id: string,
): Promise<CompatibilityMatrix | null> {
  return (await listCompatibilityMatrices(projectId)).find((item) => item.id === id) ?? null;
}

export async function saveCompatibilityMatrix(
  input: Omit<CompatibilityMatrix, "createdAt" | "updatedAt">,
): Promise<CompatibilityMatrix> {
  const { validateCompatibilityMatrix } = await import("../matrix/matrix.js");
  validateCompatibilityMatrix(input);
  return withControlStore((store) => {
    const at = now();
    const existing = store
      .matrices(input.projectId)
      .find((item) => item.id === input.id && item.projectId === input.projectId);
    const matrix: CompatibilityMatrix = {
      ...input,
      selectors: input.selectors.map((selector) => ({
        ...selector,
        ...(selector.targetIds ? { targetIds: [...selector.targetIds] } : {}),
        ...(selector.platforms ? { platforms: [...selector.platforms] } : {}),
        ...(selector.osVersionPrefixes
          ? { osVersionPrefixes: [...selector.osVersionPrefixes] }
          : {}),
        ...(selector.nameIncludes ? { nameIncludes: [...selector.nameIncludes] } : {}),
        ...(selector.requiredCapabilities
          ? { requiredCapabilities: [...selector.requiredCapabilities] }
          : {}),
      })),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    store.upsertMatrix(matrix);
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at,
      projectId: matrix.projectId,
      resource: "matrix",
      resourceId: matrix.id,
    });
    return matrix;
  });
}

export async function deleteCompatibilityMatrix(projectId: string, id: string): Promise<void> {
  return withControlStore((store) => {
    if (!store.deleteMatrix(projectId, id)) throw new Error("Compatibility matrix not found");
    emit({
      type: "resource.deleted",
      at: now(),
      projectId,
      resource: "matrix",
      resourceId: id,
    });
  });
}

export async function readProjectVariables(projectId: string): Promise<Revisioned<TestData[]>> {
  return (await readControlStore((store) => store.variables(projectId))) ?? revisioned([]);
}

export async function writeProjectVariables(
  projectId: string,
  write: ProjectVariablesWrite,
): Promise<Revisioned<TestData[]>> {
  return withControlStore((store) => {
    const validated = validateProjectVariables(write.value);
    const preserveInputIds = validateProjectInputIds(write.preserveInputIds, "Preserved");
    const requireUnlinkedInputIds = validateProjectInputIds(
      write.requireUnlinkedInputIds,
      "Unlinked",
    );
    const fingerprint = JSON.stringify(
      preserveInputIds === undefined && requireUnlinkedInputIds === undefined
        ? validated
        : {
            value: validated,
            ...(preserveInputIds ? { preserveInputIds: [...preserveInputIds].sort() } : {}),
            ...(requireUnlinkedInputIds
              ? { requireUnlinkedInputIds: [...requireUnlinkedInputIds].sort() }
              : {}),
          },
    );
    const replayKey = write.idempotencyKey
      ? `${projectId}:variables:${write.idempotencyKey}`
      : undefined;
    const recorded = replayKey ? store.idempotency(replayKey) : undefined;
    if (recorded !== undefined) {
      if (typeof recorded === "string" && recorded !== fingerprint) {
        throw new Error("Idempotency key was already used with different variable input");
      }
      return store.variables(projectId) ?? revisioned([]);
    }
    const current = store.variables(projectId) ?? revisioned([]);
    if (current.revision !== write.expectedRevision) throw new RevisionConflict(current);
    if (requireUnlinkedInputIds?.length) {
      const maps = store.listAppMaps(projectId);
      assertUnlinkedProjectInputs(
        current.value,
        maps.appMaps,
        maps.degraded.length > 0,
        requireUnlinkedInputIds,
      );
    }
    const next = writeRevision(current, {
      ...write,
      value:
        preserveInputIds === undefined
          ? validated
          : mergeProjectVariableUpdate(current.value, validated, preserveInputIds),
    });
    store.upsertVariables(projectId, next);
    if (replayKey) store.upsertIdempotency(replayKey, fingerprint);
    emit({
      type: "resource.updated",
      at: next.updatedAt,
      projectId,
      resource: "variables",
      resourceId: projectId,
      revision: next.revision,
    });
    return next;
  });
}

export async function listAppMapCatalog(projectId: string): Promise<{
  appMaps: AppMap[];
  degraded?: DegradedAppMap[];
}> {
  return readControlStore((store) => {
    const { appMaps, degraded } = store.listAppMaps(projectId);
    return degraded.length ? { appMaps, degraded } : { appMaps };
  });
}

export async function listAppMaps(projectId: string): Promise<AppMap[]> {
  return (await listAppMapCatalog(projectId)).appMaps;
}

export async function listDegradedAppMaps(projectId: string): Promise<DegradedAppMap[]> {
  return (await listAppMapCatalog(projectId)).degraded ?? [];
}

export async function readAppMap(projectId: string, appMapId: string): Promise<AppMap | null> {
  return (await readControlStore((store) => store.appMap(appMapKey(projectId, appMapId)))) ?? null;
}

/**
 * Return the opaque source retained before map normalization. Hosts can write
 * it to a recovery/export file even when a newer schema is intentionally
 * unavailable as a live App Map.
 */
export async function readAppMapRecoveryDocument(
  projectId: string,
  appMapId: string,
): Promise<AppMapRecoveryDocument | null> {
  return (
    (await readControlStore((store) =>
      store.appMapRecoveryDocument(appMapKey(projectId, appMapId)),
    )) ?? null
  );
}

export async function deleteAppMap(projectId: string, appMapId: string): Promise<boolean> {
  return withControlStore((store) => {
    const key = appMapKey(projectId, appMapId);
    const current = store.appMap(key);
    if (!current) return false;
    store.deleteAppMap(key);
    store.clearAppMapTestHistory(projectId, appMapId);
    emit({
      type: "resource.deleted",
      at: now(),
      projectId,
      resource: "app-map",
      resourceId: appMapId,
      revision: current.revision,
    });
    return true;
  });
}

export async function createAppMap(input: {
  organizationId: string;
  projectId: string;
  appMapId: string;
  name: string;
  at?: number;
}): Promise<AppMap> {
  return withControlStore((store) => {
    const key = appMapKey(input.projectId, input.appMapId);
    const operation = currentOperationContext();
    const replayKey = operation?.idempotencyKey
      ? `${input.projectId}:app-map:create:${operation.idempotencyKey}`
      : undefined;
    const fingerprint = JSON.stringify({ appMapId: input.appMapId, name: input.name });
    const existing = store.appMap(key);
    if (existing) {
      if (replayKey && store.idempotency(replayKey) === fingerprint) {
        return validateAppMap(existing);
      }
      throw new Error(`App Map ${input.appMapId} already exists`);
    }
    if (store.hasAppMap(key)) throw new Error(`App Map ${input.appMapId} already exists`);
    store.clearAppMapTestHistory(input.projectId, input.appMapId);
    if (replayKey && store.idempotency(replayKey) !== undefined) {
      throw new Error("Idempotency key was already used with different App Map input");
    }
    const at = input.at ?? now();
    const appMap = validateAppMap({
      schemaVersion: APP_MAP_SCHEMA_VERSION,
      id: input.appMapId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name.trim() || "Untitled",
      revision: 0,
      notes: {},
      groups: {},
      screens: {},
      screenVariants: {},
      connections: {},
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
      createdAt: at,
      updatedAt: at,
    });
    store.upsertAppMap(key, appMap);
    // A local map incarnation is never serialized with the portable App Map.
    // Recreating an id must not let an old reviewed-origin sidecar revive.
    store.rotateReviewedDocumentOriginMapEpoch(key, randomUUID(), at);
    if (replayKey) store.upsertIdempotency(replayKey, fingerprint);
    emit({
      type: "resource.created",
      at,
      projectId: input.projectId,
      resource: "app-map",
      resourceId: input.appMapId,
      revision: 0,
    });
    return validateAppMap(appMap);
  });
}

export async function importAppMap(input: {
  organizationId: string;
  projectId: string;
  appMap: AppMap;
  conflict?: "reject" | "replace" | "copy";
}): Promise<AppMap> {
  return withControlStore((store) => {
    const conflict = input.conflict ?? "reject";
    const desiredId = input.appMap.id;
    let appMapId = desiredId;
    let key = appMapKey(input.projectId, appMapId);
    if (store.hasAppMap(key)) {
      if (conflict === "reject") throw new Error(`App Map ${desiredId} already exists`);
      if (conflict === "copy") {
        appMapId = `${desiredId}-copy`;
        let suffix = 2;
        while (store.hasAppMap(appMapKey(input.projectId, appMapId))) {
          appMapId = `${desiredId}-copy-${suffix++}`;
        }
        key = appMapKey(input.projectId, appMapId);
      }
    }
    const existing = store.appMap(key);
    const appMap = rescopeAppMap(input.appMap, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      appMapId,
    });
    assertAppMapInputDataSetChanges(
      appMap,
      undefined,
      store.variables(input.projectId)?.value ?? [],
    );
    store.clearAppMapTestHistory(input.projectId, appMapId);
    store.upsertAppMap(key, appMap);
    // Import/replace/copy are all new local map incarnations even when the
    // portable YAML happens to have identical ids, revision, and raw hashes.
    store.rotateReviewedDocumentOriginMapEpoch(key, randomUUID(), now());
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at: now(),
      projectId: input.projectId,
      resource: "app-map",
      resourceId: appMapId,
      revision: appMap.revision,
    });
    return validateAppMap(appMap);
  });
}

function duplicateEntityRecord<
  T extends { appMapId: string; createdAt: number; updatedAt: number },
>(record: Record<string, T>, appMapId: string, at: number): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([id, entity]) => [
      id,
      { ...entity, appMapId, createdAt: at, updatedAt: at },
    ]),
  );
}

/** Copies authoring intent without pretending the new map owns the source
 * map's historical runs, proposals, or activity. Approved visual evidence is
 * retained as manual provenance so it remains useful without dangling run
 * references. */
export async function duplicateAppMap(input: {
  organizationId: string;
  projectId: string;
  sourceAppMapId: string;
  appMapId: string;
  name?: string;
  at?: number;
}): Promise<AppMap> {
  return withControlStore((store) => {
    const source = store.appMap(appMapKey(input.projectId, input.sourceAppMapId));
    if (!source || source.organizationId !== input.organizationId) {
      throw new Error(`App Map ${input.sourceAppMapId} not found`);
    }
    const key = appMapKey(input.projectId, input.appMapId);
    if (store.hasAppMap(key)) throw new Error(`App Map ${input.appMapId} already exists`);
    const at = input.at ?? now();
    const screenVariants = duplicateEntityRecord(source.screenVariants, input.appMapId, at);
    for (const variant of Object.values(screenVariants)) {
      const baseline = variant.baseline;
      if (!baseline) continue;
      const evidenceIds =
        baseline.source.kind === "run"
          ? baseline.source.evidenceId
            ? [baseline.source.evidenceId]
            : variant.evidenceIds
          : baseline.source.evidenceIds;
      variant.baseline = evidenceIds.length
        ? { ...baseline, source: { kind: "manual", evidenceIds: [...evidenceIds] } }
        : undefined;
    }
    const appMap = validateAppMap({
      ...source,
      id: input.appMapId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name?.trim() || `${source.name} (copy)`,
      revision: 0,
      notes: duplicateEntityRecord(source.notes, input.appMapId, at),
      screens: duplicateEntityRecord(source.screens, input.appMapId, at),
      screenVariants,
      connections: duplicateEntityRecord(source.connections, input.appMapId, at),
      caseStacks: duplicateEntityRecord(source.caseStacks, input.appMapId, at),
      variables: duplicateEntityRecord(source.variables ?? {}, input.appMapId, at),
      tests: duplicateEntityRecord(source.tests ?? {}, input.appMapId, at),
      combines: duplicateEntityRecord(source.combines ?? {}, input.appMapId, at),
      routines: duplicateEntityRecord(source.routines, input.appMapId, at),
      flows: duplicateEntityRecord(source.flows, input.appMapId, at),
      runs: {},
      targetResults: {},
      proposals: {},
      activity: {},
      createdAt: at,
      updatedAt: at,
    });
    assertAppMapInputDataSetChanges(
      appMap,
      undefined,
      store.variables(input.projectId)?.value ?? [],
    );
    store.clearAppMapTestHistory(input.projectId, input.appMapId);
    store.upsertAppMap(key, appMap);
    store.rotateReviewedDocumentOriginMapEpoch(key, randomUUID(), at);
    emit({
      type: "resource.created",
      at,
      projectId: input.projectId,
      resource: "app-map",
      resourceId: input.appMapId,
      revision: 0,
    });
    return validateAppMap(appMap);
  });
}

export async function mutateStoredAppMap(
  projectId: string,
  appMapId: string,
  transform: (current: AppMap, store: ControlStore) => AppMap,
  options: {
    preserveTestHistory?: boolean;
    onPersist?: (store: ControlStore, current: AppMap, next: AppMap) => void;
  } = {},
): Promise<AppMap> {
  return withControlStore((store) => {
    const key = appMapKey(projectId, appMapId);
    const current = store.appMap(key);
    if (!current) throw new Error(`App Map ${appMapId} not found`);
    const validatedCurrent = validateAppMap(current);
    const next = validateAppMap(transform(validatedCurrent, store));
    if (
      next.id !== appMapId ||
      next.projectId !== projectId ||
      next.organizationId !== validatedCurrent.organizationId
    ) {
      throw new Error("App Map mutation changed its scope");
    }
    if (next.revision !== validatedCurrent.revision + 1) {
      throw new Error("App Map mutation must advance exactly one revision");
    }
    assertAppMapInputDataSetChanges(
      next,
      validatedCurrent,
      store.variables(projectId)?.value ?? [],
    );
    if (!options.preserveTestHistory) {
      for (const [testId, previous] of Object.entries(validatedCurrent.tests)) {
        if (JSON.stringify(previous) !== JSON.stringify(next.tests[testId])) {
          store.clearAppMapTestHistoryRedo(projectId, appMapId, testId);
        }
      }
      for (const testId of Object.keys(next.tests)) {
        if (!validatedCurrent.tests[testId]) {
          store.clearAppMapTestHistoryRedo(projectId, appMapId, testId);
        }
      }
    }
    options.onPersist?.(store, validatedCurrent, next);
    store.upsertAppMap(key, next);
    emit({
      type: "resource.updated",
      at: next.updatedAt,
      projectId,
      resource: "app-map",
      resourceId: appMapId,
      revision: next.revision,
    });
    return validateAppMap(next);
  });
}
