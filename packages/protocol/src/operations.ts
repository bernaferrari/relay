import type {
  EvidenceCollectionPolicy,
  GenerationRequest,
  GenerationResult,
  JobSummary,
  JourneyMetadata,
  RedactionPolicy,
  RevisionWrite,
  Revisioned,
  RunSummary,
  SensitiveEvidenceChannel,
  TestVariable,
} from "./index.js";

export type OperationMode = "query" | "command" | "stream";
export type OperationIdempotency = "none" | "optional" | "required" | "inherent";
export type OperationConfirmation = "none" | "confirm" | "dangerous";
export type OperationCategory =
  | "system"
  | "target"
  | "authoring"
  | "execution"
  | "evidence"
  | "workspace"
  | "discovery";

export type RuntimeParser<T> = {
  readonly description: string;
  parse(value: unknown): T;
};

export type OperationTransport = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
};

export type OperationDefinition<Id extends string = string> = {
  id: Id;
  version: 1;
  label: string;
  category: OperationCategory;
  mode: OperationMode;
  input: RuntimeParser<unknown>;
  output: RuntimeParser<unknown>;
  idempotency: OperationIdempotency;
  targetCapabilities: readonly string[];
  lease: "none" | "shared" | "exclusive";
  confirmation: OperationConfirmation;
  progress: boolean;
  cancellable: boolean;
  transport: OperationTransport;
};

export type OperationRecord = Record<string, unknown>;

export type DeviceSummary = {
  id: string;
  serial: string;
  name: string;
  kind: string | null;
  booted: boolean | null;
  platform: "android" | "ios" | "browser";
  connectionState?: string;
  osVersion?: string;
};

export type ActionSummary = {
  id: string;
  title: string;
  description: string;
  category: string;
  requiresProdMatch?: boolean;
  isAlpha?: boolean;
  glyphs?: string[];
  planned?: Array<{ title: string; glyphs: string[] }>;
};

export type HealthSummary = {
  ok: boolean;
  product: string;
  version: string;
  mode: string;
  at: number;
  uptimeMs: number;
  activeJob: OperationRecord | null;
  jobs: number;
  deviceCount: number | null;
  sseClients: number;
  runsDir: string;
};

type SpecificOperationMap = {
  "system.health.get": { input: Record<string, never>; output: HealthSummary };
  "workspace.privacy.get": {
    input: Record<string, never>;
    output: { policy: RedactionPolicy };
  };
  "workspace.privacy.update": { input: { enabled: boolean }; output: { policy: RedactionPolicy } };
  "workspace.evidence.get": {
    input: Record<string, never>;
    output: { policy: EvidenceCollectionPolicy };
  };
  "workspace.evidence.update": {
    input: { channel: SensitiveEvidenceChannel; enabled: boolean; reason?: string };
    output: { policy: EvidenceCollectionPolicy };
  };
  "target.actions.list": { input: Record<string, never>; output: { actions: ActionSummary[] } };
  "target.devices.list": { input: Record<string, never>; output: { devices: DeviceSummary[] } };
  "target.select": {
    input: { serial: string | null };
    output: { ok: true; serial: string | null };
  };
  "target.snapshot.capture": {
    input: { serial?: string };
    output: { nodes: unknown[]; interactive: unknown[]; tree: string };
  };
  "target.screenshot.capture": {
    input: { serial?: string };
    output: { path: string; bytes: number; base64?: string; mime?: string };
  };
  "job.list": {
    input: { full?: boolean; limit?: number };
    output: { jobs: JobSummary[]; active?: JobSummary | null };
  };
  "job.get": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.start": {
    input: { action: string; serial?: string; [key: string]: unknown };
    output: { job: OperationRecord };
  };
  "job.cancel": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.pause": { input: { jobId: string }; output: { job: OperationRecord } };
  "job.resume": { input: { jobId: string }; output: { job: OperationRecord } };
  "run.list": { input: Record<string, never>; output: { runs: RunSummary[] } };
  "workspace.variables.get": {
    input: Record<string, never>;
    output: Revisioned<TestVariable[]>;
  };
  "workspace.variables.update": {
    input: RevisionWrite<TestVariable[]>;
    output: Revisioned<TestVariable[]>;
  };
  "journey.document.get": {
    input: { journeyId: string };
    output: Revisioned<JourneyMetadata>;
  };
  "journey.document.update": {
    input: { journeyId: string; write: RevisionWrite<JourneyMetadata> };
    output: Revisioned<JourneyMetadata>;
  };
  "generation.create": { input: GenerationRequest; output: GenerationResult };
};

type GenericOperationId =
  | "system.doctor.get"
  | "system.audit.list"
  | "target.list"
  | "target.create"
  | "target.delete"
  | "target.preflight"
  | "target.open"
  | "target.boot"
  | "target.authorize"
  | "target.interact"
  | "target.touch"
  | "target.key"
  | "target.scroll"
  | "target.video.start"
  | "project.list"
  | "project.save"
  | "build.list"
  | "build.save"
  | "device-pool.list"
  | "device-pool.save"
  | "lease.list"
  | "lease.create"
  | "lease.release"
  | "journey.list"
  | "journey.get"
  | "journey.create"
  | "journey.update"
  | "journey.delete"
  | "journey.import"
  | "journey.run"
  | "journey.history.restore"
  | "journey.evidence.save"
  | "collection.list"
  | "collection.get"
  | "collection.create"
  | "collection.update"
  | "collection.delete"
  | "collection.restore"
  | "collection.run"
  | "schedule.list"
  | "schedule.create"
  | "schedule.delete"
  | "matrix.list"
  | "matrix.create"
  | "matrix.update"
  | "matrix.delete"
  | "matrix.import"
  | "matrix.resolve"
  | "discovery.list"
  | "discovery.create"
  | "discovery.rename"
  | "discovery.status.update"
  | "discovery.capture"
  | "discovery.interact"
  | "discovery.promote"
  | "job.retry"
  | "job.active.cancel"
  | "job.graph-path.start"
  | "job.matrix.start"
  | "job.compatibility-matrix.start"
  | "job.soak.start"
  | "run.catalog.rebuild"
  | "run.retention.apply"
  | "run.visual-baseline.update"
  | "run.pin.update"
  | "step.run";

type GenericOperationMap = {
  [Id in GenericOperationId]: { input: OperationRecord; output: OperationRecord };
};

export type RelayOperationMap = SpecificOperationMap & GenericOperationMap;
export type OperationId = keyof RelayOperationMap;
export type OperationInput<Id extends OperationId> = RelayOperationMap[Id]["input"];
export type OperationOutput<Id extends OperationId> = RelayOperationMap[Id]["output"];

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}

function record(value: unknown, label: string): OperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(label, "must be an object");
  }
  return value as OperationRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) return fail(label, "must be a non-empty string");
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail(label, "must be a number");
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(label, "must be a boolean");
  return value;
}

export const operationRecordParser: RuntimeParser<OperationRecord> = {
  description: "JSON object",
  parse(value) {
    return record(value, "operation value");
  },
};

const emptyInputParser: RuntimeParser<Record<string, never>> = {
  description: "empty object",
  parse(value) {
    const input = record(value, "operation input");
    if (Object.keys(input).length) fail("operation input", "must be empty");
    return {};
  },
};

function objectParser<T extends OperationRecord>(
  description: string,
  validate?: (input: OperationRecord) => void,
): RuntimeParser<T> {
  return {
    description,
    parse(value) {
      const input = record(value, description);
      validate?.(input);
      return input as T;
    },
  };
}

const healthParser = objectParser<HealthSummary>("health response", (input) => {
  boolean(input.ok, "health ok");
  string(input.product, "health product");
  string(input.version, "health version");
  number(input.at, "health at");
  number(input.uptimeMs, "health uptimeMs");
});

const devicesParser = objectParser<{ devices: DeviceSummary[] }>("devices response", (input) => {
  if (!Array.isArray(input.devices)) fail("devices", "must be an array");
  for (const item of input.devices) {
    const device = record(item, "device");
    string(device.id, "device id");
    string(device.serial, "device serial");
    string(device.name, "device name");
  }
});

const actionsParser = objectParser<{ actions: ActionSummary[] }>("actions response", (input) => {
  if (!Array.isArray(input.actions)) fail("actions", "must be an array");
  for (const item of input.actions) {
    const action = record(item, "action");
    string(action.id, "action id");
    string(action.title, "action title");
  }
});

const screenshotParser = objectParser<OperationOutput<"target.screenshot.capture">>(
  "screenshot response",
  (input) => {
    string(input.path, "screenshot path");
    number(input.bytes, "screenshot bytes");
  },
);

const jobsParser = objectParser<OperationOutput<"job.list">>("jobs response", (input) => {
  if (!Array.isArray(input.jobs)) fail("jobs", "must be an array");
});

const runsParser = objectParser<OperationOutput<"run.list">>("runs response", (input) => {
  if (!Array.isArray(input.runs)) fail("runs", "must be an array");
});

const serialInputParser = objectParser<{ serial: string | null }>("target selection", (input) => {
  if (input.serial !== null) string(input.serial, "target serial");
});

const jobIdInputParser = objectParser<{ jobId: string }>("job input", (input) => {
  string(input.jobId, "job id");
});

const startJobInputParser = objectParser<OperationInput<"job.start">>("job input", (input) => {
  string(input.action, "job action");
});

const enabledInputParser = objectParser<{ enabled: boolean }>("enabled input", (input) => {
  boolean(input.enabled, "enabled");
});

const policyParser = objectParser<{ policy: RedactionPolicy | EvidenceCollectionPolicy }>(
  "policy response",
  (input) => record(input.policy, "policy"),
);

const generic = operationRecordParser;

type DefinitionOptions = Omit<OperationDefinition<OperationId>, "version" | "input" | "output"> & {
  input?: RuntimeParser<unknown>;
  output?: RuntimeParser<unknown>;
};

function operation(options: DefinitionOptions): OperationDefinition<OperationId> {
  return {
    ...options,
    version: 1,
    input: options.input ?? generic,
    output: options.output ?? generic,
  };
}

const query = (
  id: OperationId,
  label: string,
  path: string,
  options: Partial<DefinitionOptions> = {},
) =>
  operation({
    id,
    label,
    category: "workspace",
    mode: "query",
    idempotency: "inherent",
    targetCapabilities: [],
    lease: "none",
    confirmation: "none",
    progress: false,
    cancellable: false,
    transport: { method: "GET", path },
    ...options,
  });

const command = (
  id: OperationId,
  label: string,
  method: "POST" | "PUT" | "DELETE",
  path: string,
  options: Partial<DefinitionOptions> = {},
) =>
  operation({
    id,
    label,
    category: "workspace",
    mode: "command",
    idempotency: method === "DELETE" ? "inherent" : "optional",
    targetCapabilities: [],
    lease: "none",
    confirmation: method === "DELETE" ? "confirm" : "none",
    progress: false,
    cancellable: false,
    transport: { method, path },
    ...options,
  });

export const operationDefinitions = [
  query("system.health.get", "Get Relay health", "/health", {
    category: "system",
    input: emptyInputParser,
    output: healthParser,
  }),
  query("system.doctor.get", "Inspect Relay prerequisites", "/doctor", { category: "system" }),
  query("system.audit.list", "List audit events", "/audit", { category: "system" }),
  query("workspace.privacy.get", "Get privacy policy", "/settings/privacy", {
    input: emptyInputParser,
    output: policyParser,
  }),
  command("workspace.privacy.update", "Update privacy policy", "PUT", "/settings/privacy", {
    input: enabledInputParser,
    output: policyParser,
  }),
  query("workspace.evidence.get", "Get evidence policy", "/settings/evidence", {
    input: emptyInputParser,
    output: policyParser,
  }),
  command("workspace.evidence.update", "Update evidence consent", "PUT", "/settings/evidence", {
    input: objectParser("evidence consent", (input) => {
      string(input.channel, "evidence channel");
      boolean(input.enabled, "evidence enabled");
    }),
    output: policyParser,
    confirmation: "confirm",
  }),
  query("target.actions.list", "List available actions", "/actions", {
    category: "target",
    input: emptyInputParser,
    output: actionsParser,
  }),
  query("target.devices.list", "List connected targets", "/devices", {
    category: "target",
    input: emptyInputParser,
    output: devicesParser,
  }),
  query("target.list", "List managed targets", "/targets", { category: "target" }),
  command("target.create", "Create managed target", "POST", "/targets", { category: "target" }),
  command("target.delete", "Delete managed target", "DELETE", "/targets/:targetId", {
    category: "target",
  }),
  command("target.preflight", "Check target readiness", "POST", "/targets/:targetId/preflight", {
    category: "target",
    idempotency: "inherent",
  }),
  command("target.open", "Open managed target", "POST", "/targets/:targetId/open", {
    category: "target",
    confirmation: "confirm",
  }),
  command("target.select", "Select target", "POST", "/device/select", {
    category: "target",
    input: serialInputParser,
    output: generic,
  }),
  command("target.boot", "Boot target", "POST", "/device/boot", { category: "target" }),
  command("target.authorize", "Authorize target", "POST", "/device/authorize", {
    category: "target",
    confirmation: "confirm",
  }),
  query("target.snapshot.capture", "Capture target structure", "/snapshot", {
    category: "evidence",
    targetCapabilities: ["snapshot"],
  }),
  query("target.screenshot.capture", "Capture target screenshot", "/screenshot", {
    category: "evidence",
    targetCapabilities: ["screenshot"],
    output: screenshotParser,
  }),
  command("target.interact", "Interact with target", "POST", "/interact", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
  }),
  command("target.touch", "Send target touch", "POST", "/device/touch", {
    category: "target",
    targetCapabilities: ["tap"],
    lease: "exclusive",
  }),
  command("target.key", "Send target key", "POST", "/device/key", {
    category: "target",
    targetCapabilities: ["type"],
    lease: "exclusive",
  }),
  command("target.scroll", "Scroll target", "POST", "/device/scroll", {
    category: "target",
    targetCapabilities: ["scroll"],
    lease: "exclusive",
  }),
  command("target.video.start", "Start target video", "POST", "/device/video", {
    category: "evidence",
    targetCapabilities: ["recording"],
    lease: "shared",
  }),
  query("project.list", "List projects", "/projects"),
  command("project.save", "Save project", "POST", "/projects"),
  query("build.list", "List builds", "/builds"),
  command("build.save", "Save build", "POST", "/builds"),
  query("device-pool.list", "List device pools", "/device-pools"),
  command("device-pool.save", "Save device pool", "POST", "/device-pools"),
  query("lease.list", "List target leases", "/device-leases"),
  command("lease.create", "Lease target", "POST", "/device-leases", { confirmation: "confirm" }),
  command("lease.release", "Release target lease", "POST", "/device-leases/:leaseId/release"),
  query("workspace.variables.get", "Get project variables", "/project/variables", {
    input: emptyInputParser,
  }),
  command("workspace.variables.update", "Update project variables", "PUT", "/project/variables"),
  query("journey.list", "List Journeys", "/recipes", { category: "authoring" }),
  query("journey.get", "Get Journey", "/recipes/:journeyId", { category: "authoring" }),
  command("journey.create", "Create Journey", "POST", "/recipes", { category: "authoring" }),
  command("journey.update", "Update Journey", "PUT", "/recipes/:journeyId", {
    category: "authoring",
  }),
  command("journey.delete", "Delete Journey", "DELETE", "/recipes/:journeyId", {
    category: "authoring",
  }),
  command("journey.import", "Import Journey", "POST", "/recipes/import", {
    category: "authoring",
  }),
  command("journey.run", "Run Journey", "POST", "/recipes/:journeyId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command(
    "journey.history.restore",
    "Restore Journey history",
    "POST",
    "/recipes/:journeyId/history",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
  command(
    "journey.evidence.save",
    "Save Journey evidence",
    "POST",
    "/recipes/:journeyId/evidence",
    {
      category: "evidence",
    },
  ),
  query("journey.document.get", "Get Journey document", "/recipes/:journeyId/journey", {
    category: "authoring",
  }),
  command(
    "journey.document.update",
    "Update Journey document",
    "PUT",
    "/recipes/:journeyId/journey",
    {
      category: "authoring",
    },
  ),
  query("collection.list", "List Collections", "/suites", { category: "authoring" }),
  query("collection.get", "Get Collection", "/suites/:collectionId", { category: "authoring" }),
  command("collection.create", "Create Collection", "POST", "/suites", { category: "authoring" }),
  command("collection.update", "Update Collection", "PUT", "/suites/:collectionId", {
    category: "authoring",
  }),
  command("collection.delete", "Delete Collection", "DELETE", "/suites/:collectionId", {
    category: "authoring",
  }),
  command("collection.restore", "Restore Collection", "POST", "/suites/:collectionId/restore", {
    category: "authoring",
    confirmation: "confirm",
  }),
  command("collection.run", "Run Collection", "POST", "/suites/:collectionId/run", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("schedule.list", "List schedules", "/schedules"),
  command("schedule.create", "Create schedule", "POST", "/schedules"),
  command("schedule.delete", "Delete schedule", "DELETE", "/schedules/:scheduleId"),
  query("matrix.list", "List compatibility matrices", "/matrices"),
  command("matrix.create", "Create compatibility matrix", "POST", "/matrices"),
  command("matrix.update", "Update compatibility matrix", "PUT", "/matrices/:matrixId"),
  command("matrix.delete", "Delete compatibility matrix", "DELETE", "/matrices/:matrixId"),
  command("matrix.import", "Import compatibility matrix", "POST", "/matrices/import"),
  command("matrix.resolve", "Resolve compatibility matrix", "POST", "/matrices/:matrixId/resolve", {
    idempotency: "inherent",
  }),
  query("discovery.list", "List Discovery Maps", "/discovery", { category: "discovery" }),
  command("discovery.create", "Create Discovery Map", "POST", "/discovery", {
    category: "discovery",
  }),
  command("discovery.rename", "Rename Discovery Map", "POST", "/discovery/:sessionId/rename", {
    category: "discovery",
  }),
  command(
    "discovery.status.update",
    "Update Discovery status",
    "POST",
    "/discovery/:sessionId/status",
    {
      category: "discovery",
    },
  ),
  command(
    "discovery.capture",
    "Capture discovered screen",
    "POST",
    "/discovery/:sessionId/capture",
    {
      category: "discovery",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "shared",
    },
  ),
  command(
    "discovery.interact",
    "Explore discovered control",
    "POST",
    "/discovery/:sessionId/interact",
    {
      category: "discovery",
      targetCapabilities: ["tap"],
      lease: "exclusive",
    },
  ),
  command("discovery.promote", "Promote Discovery path", "POST", "/discovery/:sessionId/promote", {
    category: "discovery",
  }),
  query("job.list", "List jobs", "/jobs", { category: "execution", output: jobsParser }),
  query("job.get", "Get job", "/jobs/:jobId", { category: "execution", input: jobIdInputParser }),
  command("job.start", "Start job", "POST", "/jobs", {
    category: "execution",
    input: startJobInputParser,
    progress: true,
    cancellable: true,
  }),
  command("job.retry", "Retry job", "POST", "/jobs/:jobId/retry", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("job.cancel", "Cancel job", "POST", "/jobs/:jobId/cancel", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.pause", "Pause job", "POST", "/jobs/:jobId/pause", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.resume", "Resume job", "POST", "/jobs/:jobId/resume", {
    category: "execution",
    input: jobIdInputParser,
    idempotency: "inherent",
  }),
  command("job.active.cancel", "Cancel active job", "POST", "/jobs/active/cancel", {
    category: "execution",
    idempotency: "inherent",
  }),
  command("job.graph-path.start", "Run Journey path", "POST", "/jobs/graph-path", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command("job.matrix.start", "Run job matrix", "POST", "/jobs/matrix", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  command(
    "job.compatibility-matrix.start",
    "Run compatibility matrix",
    "POST",
    "/jobs/compatibility-matrix",
    {
      category: "execution",
      progress: true,
      cancellable: true,
    },
  ),
  command("job.soak.start", "Start soak run", "POST", "/jobs/soak", {
    category: "execution",
    progress: true,
    cancellable: true,
  }),
  query("run.list", "List Runs", "/runs", { category: "execution", output: runsParser }),
  command("run.catalog.rebuild", "Rebuild Run catalog", "POST", "/runs/catalog/rebuild", {
    category: "execution",
    confirmation: "confirm",
  }),
  command("run.retention.apply", "Apply Run retention", "POST", "/runs/retention", {
    category: "execution",
    confirmation: "dangerous",
  }),
  command(
    "run.visual-baseline.update",
    "Update visual baseline",
    "POST",
    "/runs/:runId/visual-baseline",
    {
      category: "evidence",
      confirmation: "confirm",
    },
  ),
  command("run.pin.update", "Pin Run", "POST", "/runs/:runId/pin", { category: "execution" }),
  command("step.run", "Run one Journey step", "POST", "/step/run", {
    category: "execution",
    targetCapabilities: ["snapshot", "tap", "type", "scroll"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
  }),
  command("generation.create", "Generate test data", "POST", "/generate", {
    category: "authoring",
  }),
] as const satisfies readonly OperationDefinition<OperationId>[];

export function operationDefinition<Id extends OperationId>(id: Id): OperationDefinition<Id> {
  const definition = operationDefinitions.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown operation: ${id}`);
  return definition as OperationDefinition<Id>;
}

export function validateOperationDefinitions(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): void {
  const ids = new Set<string>();
  const transports = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate operation id: ${definition.id}`);
    ids.add(definition.id);
    const route = `${definition.transport.method} ${definition.transport.path}`;
    if (transports.has(route)) throw new Error(`Duplicate operation transport: ${route}`);
    transports.add(route);
    if (definition.version !== 1) throw new Error(`${definition.id} has an unsupported version`);
    if (!definition.label.trim()) throw new Error(`${definition.id} is missing a label`);
    if (definition.cancellable && !definition.progress) {
      throw new Error(`${definition.id} is cancellable but does not report progress`);
    }
    if (definition.mode === "query" && definition.confirmation !== "none") {
      throw new Error(`${definition.id} is a query that requires confirmation`);
    }
    if (definition.lease !== "none" && definition.targetCapabilities.length === 0) {
      throw new Error(`${definition.id} requires a lease without a target capability`);
    }
  }
}

export type OperationManifestItem = Omit<OperationDefinition, "input" | "output"> & {
  input: string;
  output: string;
};

export function operationManifest(
  definitions: readonly OperationDefinition[] = operationDefinitions,
): OperationManifestItem[] {
  validateOperationDefinitions(definitions);
  return definitions.map(({ input, output, ...definition }) => ({
    ...definition,
    input: input.description,
    output: output.description,
  }));
}
