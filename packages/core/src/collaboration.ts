import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  type TestVariable,
} from "@relay/protocol";
import { now, publish } from "./events.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { APP_MAP_SCHEMA_VERSION, validateAppMap } from "./app-map.js";
import { rescopeAppMap } from "./app-map-yaml.js";
import { validateDevicePool } from "./device-pool.js";
import { currentOperationContext } from "./operation-context.js";

type CollaborationState = {
  projects: Project[];
  builds: Build[];
  pools: DevicePool[];
  matrices: CompatibilityMatrix[];
  leases: DeviceLease[];
  variables: Record<string, Revisioned<TestVariable[]>>;
  appMaps: Record<string, AppMap>;
  idempotency: Record<string, number | string>;
};

let queue = Promise.resolve();

function stateRoot(): string {
  return process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
}

function statePath(): string {
  return join(stateRoot(), "collaboration.json");
}

function emptyState(): CollaborationState {
  const at = now();
  return {
    projects: [
      { id: "default", organizationId: "local", name: "Mobile QA", createdAt: at, updatedAt: at },
    ],
    builds: [],
    pools: [],
    matrices: [],
    leases: [],
    variables: {},
    appMaps: {},
    idempotency: {},
  };
}

async function readState(): Promise<CollaborationState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<CollaborationState>;
    // App Map v2 is a clean product reset. Unsupported map schemas are
    // discarded instead of migrated or kept as dual state.
    const appMaps = Object.fromEntries(
      Object.entries(parsed.appMaps ?? {}).filter(
        ([, value]) => value.schemaVersion === APP_MAP_SCHEMA_VERSION && value.notes,
      ),
    );
    const empty = emptyState();
    return {
      projects: parsed.projects ?? empty.projects,
      builds: parsed.builds ?? [],
      pools: parsed.pools ?? [],
      matrices: parsed.matrices ?? [],
      leases: parsed.leases ?? [],
      variables: parsed.variables ?? {},
      appMaps,
      idempotency: parsed.idempotency ?? {},
    };
  } catch {
    return emptyState();
  }
}

async function persist(state: CollaborationState): Promise<void> {
  await mkdir(stateRoot(), { recursive: true });
  const temp = `${statePath()}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, statePath());
}

async function mutate<T>(fn: (state: CollaborationState) => Promise<T> | T): Promise<T> {
  const pending = queue.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await persist(state);
    return result;
  });
  queue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

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

export async function listProjects(organizationId = "local"): Promise<Project[]> {
  return (await readState()).projects.filter(
    (project) => project.organizationId === organizationId,
  );
}

export async function saveProject(
  input: Pick<Project, "id" | "organizationId" | "name">,
): Promise<Project> {
  return mutate((state) => {
    const at = now();
    const existing = state.projects.find((item) => item.id === input.id);
    const project: Project = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
    state.projects = [...state.projects.filter((item) => item.id !== input.id), project];
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
  return (await readState()).builds.filter((item) => item.projectId === projectId);
}

export async function readBuild(projectId: string, id: string): Promise<Build | null> {
  return (await listBuilds(projectId)).find((item) => item.id === id) ?? null;
}

export async function saveBuild(input: Omit<Build, "createdAt" | "updatedAt">): Promise<Build> {
  return mutate((state) => {
    const at = now();
    const existing = state.builds.find((item) => item.id === input.id);
    const build = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
    state.builds = [...state.builds.filter((item) => item.id !== input.id), build];
    emit({
      type: existing ? "resource.updated" : "resource.created",
      at,
      projectId: input.projectId,
      resource: "build",
      resourceId: input.id,
    });
    return build;
  });
}

export async function listDevicePools(projectId: string): Promise<DevicePool[]> {
  return (await readState()).pools.filter((item) => item.projectId === projectId);
}

export async function readDevicePool(projectId: string, id: string): Promise<DevicePool | null> {
  return (await listDevicePools(projectId)).find((item) => item.id === id) ?? null;
}

export async function saveDevicePool(
  input: Omit<DevicePool, "createdAt" | "updatedAt">,
): Promise<DevicePool> {
  validateDevicePool(input);
  return mutate((state) => {
    const at = now();
    const existing = state.pools.find((item) => item.id === input.id);
    const pool = { ...input, createdAt: existing?.createdAt ?? at, updatedAt: at };
    state.pools = [...state.pools.filter((item) => item.id !== input.id), pool];
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
  return (await readState()).matrices.filter((item) => item.projectId === projectId);
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
  return mutate((state) => {
    const at = now();
    const existing = state.matrices.find(
      (item) => item.id === input.id && item.projectId === input.projectId,
    );
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
    state.matrices = [
      ...state.matrices.filter(
        (item) => item.id !== matrix.id || item.projectId !== matrix.projectId,
      ),
      matrix,
    ];
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
  return mutate((state) => {
    const existing = state.matrices.find((item) => item.projectId === projectId && item.id === id);
    if (!existing) throw new Error("Compatibility matrix not found");
    state.matrices = state.matrices.filter(
      (item) => item.projectId !== projectId || item.id !== id,
    );
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
  return (await readState()).leases
    .filter((item) => item.projectId === projectId)
    .map((item) =>
      item.status === "leased" && item.expiresAt <= at
        ? { ...item, status: "expired" as const }
        : item,
    );
}

export async function leaseDevice(
  input: Omit<DeviceLease, "id" | "status" | "leasedAt" | "releasedAt">,
): Promise<DeviceLease> {
  return mutate((state) => {
    const at = now();
    const occupied = state.leases.find(
      (lease) =>
        lease.deviceSerial === input.deviceSerial &&
        lease.status === "leased" &&
        lease.expiresAt > at,
    );
    if (occupied) throw new Error(`Device ${input.deviceSerial} is already leased`);
    const lease: DeviceLease = {
      ...input,
      id: crypto.randomUUID(),
      status: "leased",
      leasedAt: at,
    };
    state.leases.push(lease);
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

export async function releaseDeviceLease(
  id: string,
  scope?: { projectId: string; ownerId?: string },
): Promise<DeviceLease> {
  return mutate((state) => {
    const lease = state.leases.find((item) => item.id === id);
    if (
      !lease ||
      (scope && lease.projectId !== scope.projectId) ||
      (scope?.ownerId && lease.ownerId !== scope.ownerId)
    )
      throw new Error("Device lease not found");
    lease.status = "released";
    lease.releasedAt = now();
    emit({
      type: "lease.changed",
      at: lease.releasedAt,
      projectId: lease.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return lease;
  });
}

export async function readProjectVariables(projectId: string): Promise<Revisioned<TestVariable[]>> {
  return (await readState()).variables[projectId] ?? revisioned([]);
}

function validateProjectVariables(value: TestVariable[]): TestVariable[] {
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
  write: RevisionWrite<TestVariable[]>,
): Promise<Revisioned<TestVariable[]>> {
  return mutate((state) => {
    if (
      write.idempotencyKey &&
      state.idempotency[`${projectId}:variables:${write.idempotencyKey}`]
    ) {
      return state.variables[projectId] ?? revisioned([]);
    }
    const next = writeRevision(state.variables[projectId] ?? revisioned([]), {
      ...write,
      value: validateProjectVariables(write.value),
    });
    state.variables[projectId] = next;
    if (write.idempotencyKey)
      state.idempotency[`${projectId}:variables:${write.idempotencyKey}`] = next.revision;
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

export async function listAppMaps(projectId: string): Promise<AppMap[]> {
  return Object.values((await readState()).appMaps)
    .filter((appMap) => appMap.projectId === projectId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((appMap) => validateAppMap(appMap));
}

export async function readAppMap(projectId: string, appMapId: string): Promise<AppMap | null> {
  const value = (await readState()).appMaps[appMapKey(projectId, appMapId)];
  return value ? validateAppMap(value) : null;
}

export async function deleteAppMap(projectId: string, appMapId: string): Promise<boolean> {
  return mutate((state) => {
    const key = appMapKey(projectId, appMapId);
    const current = state.appMaps[key];
    if (!current) return false;
    delete state.appMaps[key];
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
  return mutate((state) => {
    const key = appMapKey(input.projectId, input.appMapId);
    const operation = currentOperationContext();
    const replayKey = operation?.idempotencyKey
      ? `${input.projectId}:app-map:create:${operation.idempotencyKey}`
      : undefined;
    const fingerprint = JSON.stringify({ appMapId: input.appMapId, name: input.name });
    if (state.appMaps[key]) {
      if (replayKey && state.idempotency[replayKey] === fingerprint) {
        return validateAppMap(state.appMaps[key]);
      }
      throw new Error(`App Map ${input.appMapId} already exists`);
    }
    if (replayKey && state.idempotency[replayKey] !== undefined) {
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
      routines: {},
      flows: {},
      runs: {},
      targetResults: {},
      proposals: {},
      activity: {},
      createdAt: at,
      updatedAt: at,
    });
    state.appMaps[key] = appMap;
    if (replayKey) state.idempotency[replayKey] = fingerprint;
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
  return mutate((state) => {
    const conflict = input.conflict ?? "reject";
    const desiredId = input.appMap.id;
    let appMapId = desiredId;
    let key = appMapKey(input.projectId, appMapId);
    if (state.appMaps[key]) {
      if (conflict === "reject") throw new Error(`App Map ${desiredId} already exists`);
      if (conflict === "copy") {
        appMapId = `${desiredId}-copy`;
        let suffix = 2;
        while (state.appMaps[appMapKey(input.projectId, appMapId)]) {
          appMapId = `${desiredId}-copy-${suffix++}`;
        }
        key = appMapKey(input.projectId, appMapId);
      }
    }
    const existing = state.appMaps[key];
    const appMap = rescopeAppMap(input.appMap, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      appMapId,
    });
    state.appMaps[key] = appMap;
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
  return mutate((state) => {
    const source = state.appMaps[appMapKey(input.projectId, input.sourceAppMapId)];
    if (!source || source.organizationId !== input.organizationId) {
      throw new Error(`App Map ${input.sourceAppMapId} not found`);
    }
    const key = appMapKey(input.projectId, input.appMapId);
    if (state.appMaps[key]) throw new Error(`App Map ${input.appMapId} already exists`);
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
      routines: duplicateEntityRecord(source.routines, input.appMapId, at),
      flows: duplicateEntityRecord(source.flows, input.appMapId, at),
      runs: {},
      targetResults: {},
      proposals: {},
      activity: {},
      createdAt: at,
      updatedAt: at,
    });
    state.appMaps[key] = appMap;
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
  transform: (current: AppMap) => AppMap,
): Promise<AppMap> {
  return mutate((state) => {
    const key = appMapKey(projectId, appMapId);
    const current = state.appMaps[key];
    if (!current) throw new Error(`App Map ${appMapId} not found`);
    const validatedCurrent = validateAppMap(current);
    const next = validateAppMap(transform(validatedCurrent));
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
    state.appMaps[key] = next;
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
