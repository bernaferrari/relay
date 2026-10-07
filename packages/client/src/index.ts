import {
  normalizeConnection,
  type Build,
  type DeviceLease,
  type DevicePool,
  type GenerationRequest,
  type GenerationResult,
  type Project,
  type ProjectVariablesWrite,
  type Revisioned,
  type ServerConnection,
  type TestData,
  parseRunSummary,
  parseJobSummary,
  type JobSummary,
  type RunSummary,
  operationDefinition,
  type OperationId,
  type OperationInput,
  type OperationOutput,
  parseEventEnvelope,
  type EventEnvelope,
  type AuthoringInteraction,
  type CommitAuthoringSessionInput,
  type ReorderAuthoringTakeInput,
  type ReplaceAuthoringActionInput,
  type TrimAuthoringTakeInput,
} from "@relay/protocol";
import { operationRequest, registeredTransport } from "./operation-request.js";
import { ApiError } from "./api-error.js";
import {
  authoringRequestTimeout,
  authoringReplayRequestTimeout,
} from "./authoring-request-timeout.js";
export { ApiError } from "./api-error.js";
import {
  inspectExploration as inspectGoalExploration,
  inspectGoal as inspectGoalSession,
  promoteGoal as promoteGoalRequest,
  reproduceGoal as reproduceGoalRequest,
  resumeExploration as resumeGoalExploration,
  resumeGoal as resumeGoalSession,
  startExploration as startGoalExploration,
  startGoal as startGoalSession,
  type GoalControlOptions,
  type GoalPromotionInput,
  type GoalPromotionResult,
} from "./goal-client.js";
import {
  evidenceCollectionPolicy as getEvidenceCollectionPolicy,
  health as getHealth,
  redactionPolicy as getRedactionPolicy,
  setRedactionEnabled as updateRedactionEnabled,
  setSensitiveEvidenceConsent as updateSensitiveEvidenceConsent,
  soakReport as getSoakReport,
  startSoak as startSoakRequest,
} from "./workspace-client.js";
export type { GoalControlOptions, GoalPromotionInput, GoalPromotionResult } from "./goal-client.js";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordAtPath(
  root: Record<string, unknown>,
  path: readonly PropertyKey[],
): Record<string, unknown> | undefined {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = typeof key === "number" ? key : Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[String(key)];
  }
  return isRecord(current) ? current : undefined;
}

/** Additive server fields must not 502 an older operator client. Missing required
 * fields still fail closed. */
export function parseRegisteredOperationOutput<T>(
  schema: { parse: (value: unknown) => T },
  body: unknown,
): T {
  let current = body;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return schema.parse(current);
    } catch (error) {
      const stripped = stripUnrecognizedOperationKeys(current, error);
      if (stripped === undefined) throw error;
      current = stripped;
    }
  }
  return schema.parse(current);
}

function stripUnrecognizedOperationKeys(value: unknown, error: unknown): unknown | undefined {
  if (!isRecord(value) || !error || typeof error !== "object") return undefined;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return undefined;
  const clone = structuredClone(value) as Record<string, unknown>;
  let changed = false;
  for (const issue of issues) {
    if (!isRecord(issue) || issue.code !== "unrecognized_keys" || !Array.isArray(issue.keys)) {
      continue;
    }
    const path = Array.isArray(issue.path) ? issue.path : [];
    const parent = path.length === 0 ? clone : recordAtPath(clone, path);
    if (!parent) continue;
    for (const key of issue.keys) {
      if (typeof key === "string" && key in parent) {
        delete parent[key];
        changed = true;
      }
    }
  }
  return changed ? clone : undefined;
}

/** Prefer structured failure text over a bare HTTP status line. */
export function httpErrorMessage(status: number, statusText: string, body: unknown): string {
  const fallback = `${status} ${statusText}`.trim() || String(status);
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  const error = record.error;
  const fromError =
    typeof error === "string"
      ? error
      : error && typeof error === "object"
        ? (error as { message?: unknown }).message
        : undefined;
  const fromChecks = Array.isArray(record.checks)
    ? record.checks
        .flatMap((check) => {
          if (!check || typeof check !== "object") return [];
          const item = check as { ok?: unknown; message?: unknown };
          return item.ok === false && typeof item.message === "string" ? [item.message] : [];
        })
        .join("; ")
    : undefined;
  return firstNonEmptyString(fromError, record.message, fromChecks) ?? fallback;
}

export type RelayClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type InvokeOptions = {
  signal?: AbortSignal;
  requestId?: string;
  idempotencyKey?: string;
  causationId?: string;
  correlationId?: string;
  authoringSessionId?: string;
};

export type BinaryResource = {
  bytes: Uint8Array;
  headers: Headers;
};

const DEFAULT_MAX_BINARY_RESOURCE_BYTES = 32 * 1024 * 1024;

export class RelayClient {
  readonly connection: ServerConnection;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly launchTimeoutMs: number;
  private readonly recoveryTimeoutMs: number;
  private readonly planAdmissionTimeoutMs: number;
  private readonly explicitTimeoutMs: number | undefined;

  constructor(connection: ServerConnection, options: RelayClientOptions = {}) {
    this.connection = normalizeConnection(connection);
    const fetcher = options.fetch ?? fetch;
    // Browser-native fetch rejects an arbitrary `this` receiver. Keep the call
    // receiver-free even though it is stored on the client instance.
    this.fetcher = (input, init) => fetcher(input, init);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.explicitTimeoutMs = options.timeoutMs;
    // Cold app launch can take over 20 seconds before the OS acknowledges activation.
    // Keep explicit caller budgets authoritative and other operations short.
    this.launchTimeoutMs = options.timeoutMs ?? 90_000;
    this.recoveryTimeoutMs = options.timeoutMs ?? 180_000;
    // Plan admission compiles and verifies immutable evidence before queueing.
    // This is a single ACK deadline, not a Run duration or permission to resend.
    this.planAdmissionTimeoutMs = options.timeoutMs ?? 180_000;
  }

  /** Authenticated binary transport for product artifacts. */
  async download(path: string, signal?: AbortSignal): Promise<Response> {
    const deadline = AbortSignal.timeout(180_000);
    const response = await this.requestResponse(
      path,
      { signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
      "application/gzip",
      { timeout: false },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(
        response.status,
        httpErrorMessage(response.status, response.statusText, body),
        body,
      );
    }
    return response;
  }

  private async requestResponse(
    path: string,
    init: RequestInit = {},
    accept = "application/json",
    options: { timeout?: boolean; timeoutMs?: number } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", accept);
    headers.set("X-Organization-Id", this.connection.organizationId);
    headers.set("X-Project-Id", this.connection.projectId);
    headers.set("X-Relay-Actor-Id", this.connection.actorId);
    headers.set("X-Relay-Actor-Kind", this.connection.actorKind);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.connection.auth.type !== "none") {
      headers.set("Authorization", `Bearer ${this.connection.auth.token}`);
    }
    const timeoutSignal =
      options.timeout === false
        ? undefined
        : AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const signal = timeoutSignal
      ? init.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal
      : init.signal;
    return this.fetcher(`${this.connection.url}${path}`, {
      ...init,
      headers,
      signal,
    });
  }

  private async requestUnknown(
    path: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    const response = await this.requestResponse(path, init, "application/json", { timeoutMs });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        httpErrorMessage(response.status, response.statusText, body),
        body,
      );
    }
    return body;
  }

  private async goalRequest<T>(
    path: string,
    init: RequestInit = {},
    options: Pick<GoalControlOptions, "signal" | "requestId" | "idempotencyKey"> = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("X-Relay-Request-Id", options.requestId ?? crypto.randomUUID());
    if (init.method && init.method.toUpperCase() !== "GET") {
      headers.set("Idempotency-Key", options.idempotencyKey ?? crypto.randomUUID());
    }
    const body = await this.requestUnknown(
      path,
      {
        ...init,
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      this.timeoutMs,
    );
    return body as T;
  }

  private goalTransport() {
    return {
      goalRequest: <T>(
        path: string,
        init: RequestInit = {},
        options: Pick<GoalControlOptions, "signal" | "requestId" | "idempotencyKey"> = {},
      ) => this.goalRequest<T>(path, init, options),
    };
  }

  private operationHeaders(id: OperationId, options: InvokeOptions = {}): Headers {
    const headers = new Headers();
    headers.set("X-Relay-Operation-Id", id);
    headers.set("X-Relay-Request-Id", options.requestId ?? crypto.randomUUID());
    headers.set("X-Relay-Command-At", String(Date.now()));
    headers.set("Idempotency-Key", options.idempotencyKey ?? crypto.randomUUID());
    if (options.causationId) headers.set("X-Relay-Causation-Id", options.causationId);
    if (options.correlationId) headers.set("X-Relay-Correlation-Id", options.correlationId);
    if (options.authoringSessionId) {
      headers.set("X-Relay-Authoring-Session-Id", options.authoringSessionId);
    }
    return headers;
  }

  /**
   * Low-level transport for immutable artifacts and streaming-adjacent
   * resources that are intentionally not operations. Product mutations must
   * use `invoke` so both sides enforce the shared runtime contract.
   */
  async resource<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const registered = registeredTransport(path, method);
    if (!registered && method !== "GET") {
      throw new TypeError(`Unregistered mutation transport: ${method} ${path}`);
    }
    if (registered) {
      let body: unknown = {};
      if (typeof init.body === "string" && init.body) {
        try {
          body = JSON.parse(init.body) as unknown;
        } catch {
          throw new TypeError(`Invalid JSON operation body for ${method} ${path}`);
        }
      }
      const bodyRecord =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : { value: body };
      try {
        registered.definition.input.parse({ ...registered.input, ...bodyRecord });
      } catch (error) {
        throw new TypeError(
          `${registered.definition.id} has invalid input: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const response = await this.requestUnknown(path, {
      ...init,
      ...(registered ? { headers: this.operationHeaders(registered.definition.id) } : {}),
    });
    if (registered) {
      try {
        parseRegisteredOperationOutput(registered.definition.output, response);
      } catch (error) {
        throw new ApiError(
          502,
          `${registered.definition.id} returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
          response,
        );
      }
    }
    return response as T;
  }

  /** Fetch an explicitly registered read resource without materializing it as
   * JSON. This is used for bounded binary frame bodies; response metadata is
   * returned separately so callers can validate it before painting bytes. */
  async binaryResource(
    path: string,
    init: RequestInit = {},
    maxBytes = DEFAULT_MAX_BINARY_RESOURCE_BYTES,
  ): Promise<BinaryResource> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") throw new TypeError(`Binary resources must use GET: ${method} ${path}`);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError("Binary resource byte limit must be a positive safe integer");
    }
    const registered = registeredTransport(path, method);
    const response = await this.requestResponse(
      path,
      {
        ...init,
        ...(registered ? { headers: this.operationHeaders(registered.definition.id) } : {}),
      },
      "application/octet-stream, image/jpeg;q=0.9",
    );
    if (!response.ok) {
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      throw new ApiError(
        response.status,
        httpErrorMessage(response.status, response.statusText, body),
        body,
      );
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
        throw new TypeError(`Binary resource exceeds its ${maxBytes}-byte limit`);
      }
    }
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new TypeError(`Binary resource exceeds its ${maxBytes}-byte limit`);
      }
      return { bytes, headers: response.headers };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel("binary resource byte limit exceeded");
          throw new TypeError(`Binary resource exceeds its ${maxBytes}-byte limit`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, headers: response.headers };
  }

  /** Open a long-lived registered binary resource without the ordinary JSON
   * request timeout. Stream consumers own cancellation through `signal`. */
  async openStream(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") throw new TypeError(`Streams must use GET: ${method}`);
    const registered = registeredTransport(path, method);
    const response = await this.requestResponse(
      path,
      {
        ...init,
        ...(registered ? { headers: this.operationHeaders(registered.definition.id) } : {}),
      },
      "application/octet-stream, application/x-relay-h264, application/x-relay-mjpeg",
      { timeout: false },
    );
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      throw new ApiError(
        response.status,
        httpErrorMessage(response.status, response.statusText, body),
        body,
      );
    }
    return response;
  }

  async invoke<Id extends OperationId>(
    id: Id,
    input: OperationInput<Id>,
    options: InvokeOptions = {},
  ): Promise<OperationOutput<Id>> {
    const definition = operationDefinition(id);
    const request = operationRequest(id, input);
    let authoringTimeout = authoringRequestTimeout(id, input, this.timeoutMs);
    if (this.explicitTimeoutMs === undefined && id === "authoring.take.replay") {
      const replay = input as OperationInput<"authoring.take.replay">;
      const current = await this.invoke(
        "authoring.session.get",
        { sessionId: replay.sessionId },
        { signal: options.signal },
      );
      authoringTimeout = authoringReplayRequestTimeout(current.session, this.timeoutMs);
    } else if (this.explicitTimeoutMs === undefined && id === "workflow.transition") {
      const replay = input as OperationInput<"workflow.transition">;
      if (replay.action === "authoring-replay") {
        const current = await this.invoke(
          "workflow.get",
          { workflowId: replay.workflowId },
          { signal: options.signal },
        );
        authoringTimeout = authoringReplayRequestTimeout(current.session, this.timeoutMs);
      }
    }
    const body = await this.requestUnknown(
      request.path,
      {
        ...request.init,
        headers: this.operationHeaders(id, options),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      id === "target.recover"
        ? this.recoveryTimeoutMs
        : id === "job.combine.start" || id === "job.combine.campaign.resume"
          ? this.planAdmissionTimeoutMs
          : id === "target.app.launch" || id === "target.snapshot.capture"
            ? this.launchTimeoutMs
            : (this.explicitTimeoutMs ?? authoringTimeout),
    );
    try {
      return parseRegisteredOperationOutput(definition.output, body);
    } catch (error) {
      throw new ApiError(
        502,
        `${id} returned an invalid response: ${error instanceof Error ? error.message : String(error)}`,
        body,
      );
    }
  }

  scoped(projectId: string): RelayClient {
    return new RelayClient(
      { ...this.connection, projectId },
      { fetch: this.fetcher, timeoutMs: this.explicitTimeoutMs },
    );
  }

  health() {
    return getHealth(this);
  }
  redactionPolicy() {
    return getRedactionPolicy(this);
  }
  setRedactionEnabled(enabled: boolean) {
    return updateRedactionEnabled(this, enabled);
  }
  evidenceCollectionPolicy() {
    return getEvidenceCollectionPolicy(this);
  }
  setSensitiveEvidenceConsent(
    channel: Parameters<typeof updateSensitiveEvidenceConsent>[1],
    enabled: boolean,
    reason?: string,
  ) {
    return updateSensitiveEvidenceConsent(this, channel, enabled, reason);
  }
  async jobs(): Promise<{ jobs: JobSummary[] }> {
    const body = await this.invoke("job.list", {});
    if (!body || !Array.isArray(body.jobs))
      throw new ApiError(502, "Malformed jobs response", body);
    try {
      return { jobs: body.jobs.map(parseJobSummary) };
    } catch (error) {
      throw new ApiError(502, error instanceof Error ? error.message : String(error), body);
    }
  }
  async runs(
    input: {
      limit?: number;
      appMapId?: string;
      cursor?: string;
    } = {},
  ): Promise<{ runs: RunSummary[]; totalCount?: number; nextCursor?: string }> {
    const body = await this.invoke("run.list", input);
    if (!body || !Array.isArray(body.runs))
      throw new ApiError(502, "Malformed runs response", body);
    try {
      return {
        runs: body.runs.map(parseRunSummary),
        ...(typeof body.totalCount === "number" ? { totalCount: body.totalCount } : {}),
        ...(typeof body.nextCursor === "string" ? { nextCursor: body.nextCursor } : {}),
      };
    } catch (error) {
      throw new ApiError(502, error instanceof Error ? error.message : String(error), body);
    }
  }
  startSoak(input: Parameters<typeof startSoakRequest>[1]) {
    return startSoakRequest(this, input);
  }
  soakReport(batchId: string) {
    return getSoakReport(this, batchId);
  }
  projects(): Promise<{ projects: Project[] }> {
    return this.invoke("project.list", {}) as Promise<{ projects: Project[] }>;
  }
  saveProject(project: Pick<Project, "id" | "name">): Promise<{ project: Project }> {
    return this.invoke("project.save", project) as Promise<{ project: Project }>;
  }
  builds(): Promise<{ builds: Build[] }> {
    return this.invoke("build.list", {}) as Promise<{ builds: Build[] }>;
  }
  saveBuild(
    build: Omit<Build, "projectId" | "createdAt" | "updatedAt">,
  ): Promise<{ build: Build }> {
    return this.invoke("build.save", build) as Promise<{ build: Build }>;
  }
  devicePools(): Promise<{ pools: DevicePool[] }> {
    return this.invoke("device-pool.list", {}) as Promise<{ pools: DevicePool[] }>;
  }
  saveDevicePool(
    pool: Omit<DevicePool, "projectId" | "createdAt" | "updatedAt">,
  ): Promise<{ pool: DevicePool }> {
    return this.invoke("device-pool.save", pool) as Promise<{ pool: DevicePool }>;
  }
  leases(): Promise<{ leases: DeviceLease[] }> {
    return this.invoke("lease.list", {}) as Promise<{ leases: DeviceLease[] }>;
  }
  lease(input: OperationInput<"lease.create">): Promise<{ lease: DeviceLease }> {
    return this.invoke("lease.create", input) as Promise<{ lease: DeviceLease }>;
  }
  takeOverLease(input: OperationInput<"lease.takeover">): Promise<{ lease: DeviceLease }> {
    return this.invoke("lease.takeover", input) as Promise<{ lease: DeviceLease }>;
  }
  releaseLease(id: string): Promise<{ lease: DeviceLease }> {
    return this.invoke("lease.release", { leaseId: id }) as Promise<{ lease: DeviceLease }>;
  }
  variables(): Promise<Revisioned<TestData[]>> {
    return this.invoke("workspace.variables.get", {}) as Promise<Revisioned<TestData[]>>;
  }
  updateVariables(write: ProjectVariablesWrite): Promise<Revisioned<TestData[]>> {
    return this.invoke("workspace.variables.update", write) as Promise<Revisioned<TestData[]>>;
  }
  authoringSessions(input: OperationInput<"authoring.session.list"> = {}) {
    return this.invoke("authoring.session.list", input);
  }
  appMaps() {
    return this.invoke("app-map.list", {});
  }
  appMap(appMapId: string) {
    return this.invoke("app-map.get", { appMapId });
  }
  editAppMapTest(input: OperationInput<"app-map.test.edit">) {
    return this.invoke("app-map.test.edit", input);
  }
  saveAppMapTest(input: OperationInput<"app-map.test.save">) {
    return this.invoke("app-map.test.save", input);
  }
  proposeAppMapTest(input: OperationInput<"app-map.test.propose">) {
    return this.invoke("app-map.test.propose", input);
  }
  activity(input: OperationInput<"activity.list"> = {}) {
    return this.invoke("activity.list", input);
  }
  authoringSession(sessionId: string) {
    return this.invoke("authoring.session.get", { sessionId });
  }
  createAuthoringSession(input: OperationInput<"authoring.session.create">) {
    return this.invoke("authoring.session.create", input, { authoringSessionId: undefined });
  }
  observeAuthoringSession(sessionId: string, signal?: AbortSignal) {
    return this.invoke(
      "authoring.session.observe",
      { sessionId },
      { authoringSessionId: sessionId, ...(signal ? { signal } : {}) },
    );
  }
  captureAuthoringScreen(sessionId: string, signal?: AbortSignal) {
    return this.invoke(
      "authoring.session.capture",
      { sessionId },
      { authoringSessionId: sessionId, ...(signal ? { signal } : {}) },
    );
  }
  startAuthoringSession(sessionId: string, signal?: AbortSignal) {
    return this.invoke(
      "authoring.session.start",
      { sessionId },
      {
        authoringSessionId: sessionId,
        ...(signal ? { signal } : {}),
      },
    );
  }
  interactAuthoringSession(sessionId: string, interaction: AuthoringInteraction) {
    return this.invoke(
      "authoring.session.interact",
      { sessionId, interaction },
      { authoringSessionId: sessionId },
    );
  }
  stopAuthoringSession(sessionId: string, signal?: AbortSignal) {
    return this.invoke(
      "authoring.session.stop",
      { sessionId },
      {
        authoringSessionId: sessionId,
        ...(signal ? { signal } : {}),
      },
    );
  }
  trimAuthoringTake(input: TrimAuthoringTakeInput) {
    return this.invoke("authoring.take.trim", input, { authoringSessionId: input.sessionId });
  }
  reorderAuthoringTake(input: ReorderAuthoringTakeInput) {
    return this.invoke("authoring.take.reorder", input, { authoringSessionId: input.sessionId });
  }
  replaceAuthoringAction(input: ReplaceAuthoringActionInput) {
    return this.invoke("authoring.take.replace", input, { authoringSessionId: input.sessionId });
  }
  replayAuthoringTake(sessionId: string, signal?: AbortSignal) {
    return this.invoke(
      "authoring.take.replay",
      { sessionId },
      { authoringSessionId: sessionId, signal },
    );
  }
  commitAuthoringSession(input: CommitAuthoringSessionInput) {
    return this.invoke("authoring.session.commit", input, {
      authoringSessionId: input.sessionId,
    });
  }
  discardAuthoringSession(sessionId: string) {
    return this.invoke(
      "authoring.session.discard",
      { sessionId },
      { authoringSessionId: sessionId },
    );
  }
  cancelAuthoringSession(sessionId: string) {
    return this.invoke(
      "authoring.session.cancel",
      { sessionId },
      { authoringSessionId: sessionId },
    );
  }
  cleanupAuthoringSession(sessionId: string) {
    return this.invoke(
      "authoring.session.cleanup",
      { sessionId },
      { authoringSessionId: sessionId },
    );
  }
  generate(input: GenerationRequest): Promise<GenerationResult> {
    return this.invoke("generation.create", input);
  }

  /** Start one bounded goal without requiring a saved Test or App Map. */
  startGoal(input: Parameters<typeof startGoalSession>[1], options: GoalControlOptions) {
    return startGoalSession(this.goalTransport(), input, options);
  }

  /** Start independent bounded workers against isolated signed-out browser targets. */
  startExploration(input: Parameters<typeof startGoalExploration>[1], options: GoalControlOptions) {
    return startGoalExploration(this.goalTransport(), input, options);
  }

  inspectGoal(sessionId: string, signal?: AbortSignal) {
    return inspectGoalSession(this.goalTransport(), sessionId, signal);
  }

  inspectExploration(explorationId: string, signal?: AbortSignal) {
    return inspectGoalExploration(this.goalTransport(), explorationId, signal);
  }

  resumeGoal(sessionId: string, options: GoalControlOptions) {
    return resumeGoalSession(this.goalTransport(), sessionId, options);
  }

  resumeExploration(explorationId: string, options: GoalControlOptions) {
    return resumeGoalExploration(this.goalTransport(), explorationId, options);
  }

  reproduceGoal(sessionId: string, options: GoalControlOptions) {
    return reproduceGoalRequest(this.goalTransport(), sessionId, options);
  }

  promoteGoal(input: GoalPromotionInput, options: GoalControlOptions) {
    return promoteGoalRequest(this.goalTransport(), input, options);
  }

  async events(
    onEvent: (event: EventEnvelope) => void,
    options: {
      signal?: AbortSignal;
      onOpen?: () => void;
      afterSequence?: number;
      onGap?: (event: EventEnvelope) => void;
    } = {},
  ): Promise<void> {
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Organization-Id": this.connection.organizationId,
      "X-Project-Id": this.connection.projectId,
      "X-Relay-Actor-Id": this.connection.actorId,
      "X-Relay-Actor-Kind": this.connection.actorKind,
    });
    for (const [key, value] of this.operationHeaders("event.stream")) headers.set(key, value);
    if (options.afterSequence && options.afterSequence > 0) {
      headers.set("Last-Event-ID", String(options.afterSequence));
    }
    if (this.connection.auth.type !== "none")
      headers.set("Authorization", `Bearer ${this.connection.auth.token}`);
    const response = await this.fetcher(`${this.connection.url}/events`, {
      headers,
      signal: options.signal,
    });
    if (!response.ok || !response.body)
      throw new ApiError(response.status, "Unable to connect to events");
    options.onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cursor = options.afterSequence ?? 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            const event = parseEventEnvelope(JSON.parse(data));
            if (event.sequence > cursor) {
              cursor = event.sequence;
              if (event.payload.type === "stream.gap") options.onGap?.(event);
              onEvent(event);
            }
          } catch {
            /* ignore malformed event */
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}
