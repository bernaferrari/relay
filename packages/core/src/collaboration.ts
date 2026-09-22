import {
  RevisionConflict,
  type AppMap,
  type Build,
  type CompatibilityMatrix,
  type DeviceLease,
  type DevicePool,
  type Project,
  type ResourceEvent,
  type RevisionWrite,
  type Revisioned,
  type TestData,
} from "@relay/protocol";
import { randomUUID } from "node:crypto";
import { now, publish } from "./events.js";
import { APP_MAP_SCHEMA_VERSION, validateAppMap } from "./app-map.js";
import { rescopeAppMap } from "./app-map-yaml.js";
import { validateDevicePool } from "./device-pool.js";
import { currentOperationContext } from "./operation-context.js";
import { assertWebBuildProviderReceipt } from "./web-build-verification.js";
import {
  readControlStore,
  withControlStore,
  type AppMapRecoveryDocument,
  type ControlStore,
  type DegradedAppMap,
} from "./collaboration-store.js";

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

/** Local/agent leases last long enough for a Settings tour + a server blink. */
export const DEVICE_LEASE_TTL_MS = 2 * 60 * 60 * 1000;
/** Touching the device with <30 minutes left extends the same lease. */
export const DEVICE_LEASE_RENEW_UNDER_MS = 30 * 60 * 1000;

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
  const { validateCompatibilityMatrix } = await import("./matrix.js");
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

export async function listDeviceLeases(projectId: string): Promise<DeviceLease[]> {
  const at = now();
  return (await readControlStore((store) => store.leases(projectId))).map((item) =>
    item.status === "leased" && item.expiresAt <= at
      ? { ...item, status: "expired" as const }
      : item,
  );
}

/** Read-only execution check. It never creates, renews, or changes a lease. */
export async function isDeviceLeaseClaimActive(
  input: {
    organizationId?: string;
    projectId: string;
    deviceSerial: string;
    ownerId: string;
    leaseId: string;
  },
  at = now(),
): Promise<boolean> {
  const lease = await readControlStore((store) => store.lease(input.leaseId));
  return Boolean(
    lease &&
    (!input.organizationId ||
      lease.organizationId === input.organizationId ||
      (!lease.organizationId && lease.controlScope !== "local-project")) &&
    lease.projectId === input.projectId &&
    lease.deviceSerial === input.deviceSerial &&
    lease.ownerId === input.ownerId &&
    lease.status === "leased" &&
    lease.expiresAt > at,
  );
}

/** Validate the exact lease owner frozen into an execution context. This is
 * distinct from actor attribution because a trusted local project can share a
 * server-owned control session while every command retains its real actor. */
export async function isDeviceLeaseSessionActive(
  input: {
    organizationId?: string;
    projectId: string;
    deviceSerial: string;
    leaseId: string;
    leaseOwnerId: string;
  },
  at = now(),
): Promise<boolean> {
  return isDeviceLeaseClaimActive(
    {
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      projectId: input.projectId,
      deviceSerial: input.deviceSerial,
      ownerId: input.leaseOwnerId,
      leaseId: input.leaseId,
    },
    at,
  );
}

export async function leaseDevice(
  input: Omit<DeviceLease, "id" | "status" | "leasedAt" | "releasedAt">,
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const occupied = store.activeLeaseOnDevice(input.deviceSerial, at);
    if (occupied) throw new Error(`Device ${input.deviceSerial} is already leased`);
    const lease: DeviceLease = {
      ...input,
      id: crypto.randomUUID(),
      status: "leased",
      leasedAt: at,
    };
    store.upsertLease(lease);
    emit({
      type: "lease.changed",
      at,
      projectId: input.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return lease;
  });
}

export async function renewDeviceLease(id: string, expiresAt: number): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const lease = store.lease(id);
    if (!lease || lease.status !== "leased") throw new Error("Device lease not found");
    if (expiresAt <= at) throw new Error("Renewal expiry must be in the future");
    const next = { ...lease, expiresAt };
    store.upsertLease(next);
    emit({
      type: "lease.changed",
      at,
      projectId: lease.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return next;
  });
}

export async function releaseDeviceLease(
  id: string,
  scope?: { projectId: string; ownerId?: string },
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const lease = store.lease(id);
    if (
      !lease ||
      (scope && lease.projectId !== scope.projectId) ||
      (scope?.ownerId && lease.ownerId !== scope.ownerId)
    )
      throw new Error("Device lease not found");
    const next: DeviceLease = { ...lease, status: "released", releasedAt: now() };
    store.upsertLease(next);
    emit({
      type: "lease.changed",
      at: next.releasedAt!,
      projectId: lease.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return next;
  });
}

/**
 * Atomically hand an actively leased device to another actor. The caller must
 * name the exact lease it observed, which prevents a stale confirmation from
 * replacing a newer owner. Both sides remain visible in lease history.
 */
export async function takeOverDeviceLease(
  id: string,
  input: {
    organizationId?: string;
    projectId: string;
    ownerId: string;
    controlScope?: DeviceLease["controlScope"];
    expiresAt: number;
    reason: string;
  },
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const current = store.lease(id);
    if (
      !current ||
      current.projectId !== input.projectId ||
      (input.organizationId && current.organizationId !== input.organizationId) ||
      current.status !== "leased" ||
      current.expiresAt <= at
    ) {
      throw new Error("Active device lease not found");
    }
    if (input.expiresAt <= at) throw new Error("Takeover expiry must be in the future");
    const reason = input.reason.trim();
    if (!reason) throw new Error("Takeover reason is required");

    store.upsertLease({ ...current, status: "released", releasedAt: at });
    const lease: DeviceLease = {
      id: crypto.randomUUID(),
      ...(current.organizationId ? { organizationId: current.organizationId } : {}),
      projectId: current.projectId,
      poolId: current.poolId,
      deviceSerial: current.deviceSerial,
      ownerId: input.ownerId,
      ...(input.controlScope ? { controlScope: input.controlScope } : {}),
      status: "leased",
      leasedAt: at,
      expiresAt: input.expiresAt,
      handoffFromLeaseId: current.id,
      handoffReason: reason,
    };
    store.upsertLease(lease);
    for (const resourceId of [current.id, lease.id]) {
      emit({
        type: "lease.changed",
        at,
        projectId: current.projectId,
        resource: "lease",
        resourceId,
      });
    }
    return lease;
  });
}

export async function readProjectVariables(projectId: string): Promise<Revisioned<TestData[]>> {
  return (await readControlStore((store) => store.variables(projectId))) ?? revisioned([]);
}

function validateProjectVariables(value: TestData[]): TestData[] {
  if (!Array.isArray(value)) throw new Error("Variables must be an array");
  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((variable) => {
    const id = variable.id.trim();
    const name = variable.name.trim();
    if (!id || !name) throw new Error("Every variable needs an id and name");
    if (ids.has(id)) throw new Error(`Variable id ${id} is duplicated`);
    if (names.has(name)) throw new Error(`Variable name ${name} is duplicated`);
    ids.add(id);
    names.add(name);
    if (!(variable.scope === "shared" || variable.scope === "private")) {
      throw new Error(`Variable ${name} has an invalid scope`);
    }
    if (
      !(
        variable.source === "static" ||
        variable.source === "list" ||
        variable.source === "generated"
      )
    ) {
      throw new Error(`Variable ${name} has an invalid source`);
    }
    if (variable.scope === "private" && (variable.values?.length || variable.fallback)) {
      throw new Error(`Private variable ${name} cannot persist a value or fallback`);
    }
    return {
      ...structuredClone(variable),
      id,
      name,
      ...(variable.values
        ? { values: variable.values.map((item) => item.trim()).filter(Boolean) }
        : {}),
    };
  });
}

export async function writeProjectVariables(
  projectId: string,
  write: RevisionWrite<TestData[]>,
): Promise<Revisioned<TestData[]>> {
  return withControlStore((store) => {
    const validated = validateProjectVariables(write.value);
    const fingerprint = JSON.stringify(validated);
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
    const next = writeRevision(store.variables(projectId) ?? revisioned([]), {
      ...write,
      value: validated,
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

function appMapKey(projectId: string, appMapId: string): string {
  return `${projectId}:${appMapId}`;
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
