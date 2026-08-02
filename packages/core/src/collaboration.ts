import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RevisionConflict,
  type AppMap,
  type Build,
  type CompatibilityMatrix,
  type DeviceLease,
  type DevicePool,
  type JourneyMetadata,
  type Project,
  type ResourceEvent,
  type RevisionWrite,
  type Revisioned,
  type TestVariable,
} from "@relay/protocol";
import { now, publish } from "./events.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { commitJourneyAggregate, readJourneyAggregate } from "./journey-aggregate.js";
import { currentOperationContext } from "./operation-context.js";
import { APP_MAP_SCHEMA_VERSION, validateAppMap } from "./app-map.js";
import { validateDevicePool } from "./device-pool.js";

type CollaborationState = {
  projects: Project[];
  builds: Build[];
  pools: DevicePool[];
  matrices: CompatibilityMatrix[];
  leases: DeviceLease[];
  variables: Record<string, Revisioned<TestVariable[]>>;
  journeys: Record<string, Revisioned<JourneyMetadata>>;
  appMaps: Record<string, AppMap>;
  idempotency: Record<string, number>;
};

const EMPTY_JOURNEY: JourneyMetadata = {
  schemaVersion: 6,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
  review: { state: "draft", updatedAt: now() },
  graph: { schemaVersion: 1, screens: [], transitions: [], flows: [] },
};
let queue = Promise.resolve();

function stateRoot(): string {
  return (
    (process.env.RELAY_STATE_DIR ?? process.env.GROK_DEVICE_STATE_DIR)?.trim() ||
    join(findWorkspaceRoot(), ".relay")
  );
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
    journeys: {},
    appMaps: {},
    idempotency: {},
  };
}

async function readState(): Promise<CollaborationState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<CollaborationState>;
    // State files are intentionally forwards-compatible. New resources do not
    // make an existing local project unreadable after an upgrade.
    return {
      ...emptyState(),
      ...parsed,
      matrices: parsed.matrices ?? [],
      appMaps: parsed.appMaps ?? {},
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
    const next = writeRevision(state.variables[projectId] ?? revisioned([]), write);
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

export async function readJourney(
  projectId: string,
  recipeId: string,
): Promise<Revisioned<JourneyMetadata>> {
  const aggregate = await readJourneyAggregate(projectId, recipeId);
  if (aggregate) return structuredClone(aggregate.document);
  return (await readState()).journeys[`${projectId}:${recipeId}`] ?? revisioned(EMPTY_JOURNEY);
}

export async function writeJourney(
  projectId: string,
  recipeId: string,
  write: RevisionWrite<JourneyMetadata>,
): Promise<Revisioned<JourneyMetadata>> {
  const aggregate = await readJourneyAggregate(projectId, recipeId);
  if (aggregate) {
    const replayKey = write.idempotencyKey;
    if (aggregate.document.revision !== write.expectedRevision) {
      throw new RevisionConflict(aggregate.document);
    }
    const next = writeRevision(aggregate.document, write);
    const operation = currentOperationContext();
    await commitJourneyAggregate({
      organizationId: operation?.organizationId ?? aggregate.organizationId,
      projectId,
      journeyId: recipeId,
      recipe: aggregate.recipe,
      document: next,
      evidence: aggregate.evidence,
      ...(replayKey ? { transactionId: `${recipeId}:document:${replayKey}` } : {}),
    });
    emit({
      type: "resource.updated",
      at: next.updatedAt,
      projectId,
      resource: "journey",
      resourceId: recipeId,
      revision: next.revision,
    });
    return next;
  }
  return mutate((state) => {
    const key = `${projectId}:${recipeId}`;
    if (write.idempotencyKey && state.idempotency[`${key}:${write.idempotencyKey}`])
      return state.journeys[key] ?? revisioned(EMPTY_JOURNEY);
    const next = writeRevision(state.journeys[key] ?? revisioned(EMPTY_JOURNEY), write);
    state.journeys[key] = next;
    if (write.idempotencyKey) state.idempotency[`${key}:${write.idempotencyKey}`] = next.revision;
    emit({
      type: "resource.updated",
      at: next.updatedAt,
      projectId,
      resource: "journey",
      resourceId: recipeId,
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

export async function createAppMap(input: {
  organizationId: string;
  projectId: string;
  appMapId: string;
  name: string;
  at?: number;
}): Promise<AppMap> {
  return mutate((state) => {
    const key = appMapKey(input.projectId, input.appMapId);
    if (state.appMaps[key]) throw new Error(`App Map ${input.appMapId} already exists`);
    const at = input.at ?? now();
    const appMap = validateAppMap({
      schemaVersion: APP_MAP_SCHEMA_VERSION,
      id: input.appMapId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name.trim() || "Untitled",
      revision: 0,
      screens: {},
      screenVariants: {},
      connections: {},
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
