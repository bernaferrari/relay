import {
  normalizeConnection,
  type Build,
  type DeviceLease,
  type DevicePool,
  type GenerationRequest,
  type GenerationResult,
  type JourneyMetadata,
  type Project,
  type RevisionWrite,
  type Revisioned,
  type ServerConnection,
  type TestVariable,
  parseRunSummary,
  parseJobSummary,
  type JobSummary,
  type RedactionPolicy,
  type RunSummary,
} from "@relay/protocol";

export class ApiError<T = unknown> extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: T,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type RelayClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class RelayClient {
  readonly connection: ServerConnection;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(connection: ServerConnection, options: RelayClientOptions = {}) {
    this.connection = normalizeConnection(connection);
    const fetcher = options.fetch ?? fetch;
    // Browser-native fetch rejects an arbitrary `this` receiver. Keep the call
    // receiver-free even though it is stored on the client instance.
    this.fetcher = (input, init) => fetcher(input, init);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Organization-Id", this.connection.organizationId);
    headers.set("X-Project-Id", this.connection.projectId);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.connection.auth.type !== "none") {
      headers.set("Authorization", `Bearer ${this.connection.auth.token}`);
    }
    const signal = init.signal ?? AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetcher(`${this.connection.url}${path}`, {
      ...init,
      headers,
      signal,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const message =
        typeof body === "object" && body && "error" in body
          ? String((body as { error: unknown }).error)
          : `${response.status} ${response.statusText}`;
      throw new ApiError(response.status, message, body);
    }
    return body as T;
  }

  scoped(projectId: string): RelayClient {
    return new RelayClient(
      { ...this.connection, projectId },
      { fetch: this.fetcher, timeoutMs: this.timeoutMs },
    );
  }

  health<T = unknown>(): Promise<T> {
    return this.request<T>("/health");
  }
  redactionPolicy(): Promise<{ policy: RedactionPolicy }> {
    return this.request("/settings/privacy");
  }
  setRedactionEnabled(enabled: boolean): Promise<{ policy: RedactionPolicy }> {
    return this.request("/settings/privacy", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  }
  async jobs(): Promise<{ jobs: JobSummary[] }> {
    const body = await this.request<{ jobs?: unknown }>("/jobs?full=0");
    if (!body || !Array.isArray(body.jobs))
      throw new ApiError(502, "Malformed jobs response", body);
    try {
      return { jobs: body.jobs.map(parseJobSummary) };
    } catch (error) {
      throw new ApiError(502, error instanceof Error ? error.message : String(error), body);
    }
  }
  async runs(): Promise<{ runs: RunSummary[] }> {
    const body = await this.request<{ runs?: unknown }>("/runs");
    if (!body || !Array.isArray(body.runs))
      throw new ApiError(502, "Malformed runs response", body);
    try {
      return { runs: body.runs.map(parseRunSummary) };
    } catch (error) {
      throw new ApiError(502, error instanceof Error ? error.message : String(error), body);
    }
  }
  projects(): Promise<{ projects: Project[] }> {
    return this.request("/projects");
  }
  saveProject(project: Pick<Project, "id" | "name">): Promise<{ project: Project }> {
    return this.request("/projects", { method: "POST", body: JSON.stringify(project) });
  }
  builds(): Promise<{ builds: Build[] }> {
    return this.request("/builds");
  }
  saveBuild(
    build: Omit<Build, "projectId" | "createdAt" | "updatedAt">,
  ): Promise<{ build: Build }> {
    return this.request("/builds", { method: "POST", body: JSON.stringify(build) });
  }
  devicePools(): Promise<{ pools: DevicePool[] }> {
    return this.request("/device-pools");
  }
  saveDevicePool(
    pool: Omit<DevicePool, "projectId" | "createdAt" | "updatedAt">,
  ): Promise<{ pool: DevicePool }> {
    return this.request("/device-pools", { method: "POST", body: JSON.stringify(pool) });
  }
  leases(): Promise<{ leases: DeviceLease[] }> {
    return this.request("/device-leases");
  }
  lease(
    input: Pick<DeviceLease, "poolId" | "deviceSerial" | "ownerId" | "expiresAt">,
  ): Promise<{ lease: DeviceLease }> {
    return this.request("/device-leases", { method: "POST", body: JSON.stringify(input) });
  }
  releaseLease(id: string): Promise<{ lease: DeviceLease }> {
    return this.request(`/device-leases/${encodeURIComponent(id)}/release`, {
      method: "POST",
      body: "{}",
    });
  }
  variables(): Promise<Revisioned<TestVariable[]>> {
    return this.request("/project/variables");
  }
  updateVariables(write: RevisionWrite<TestVariable[]>): Promise<Revisioned<TestVariable[]>> {
    return this.request("/project/variables", { method: "PUT", body: JSON.stringify(write) });
  }
  journey(recipeId: string): Promise<Revisioned<JourneyMetadata>> {
    return this.request(`/recipes/${encodeURIComponent(recipeId)}/journey`);
  }
  updateJourney(
    recipeId: string,
    write: RevisionWrite<JourneyMetadata>,
  ): Promise<Revisioned<JourneyMetadata>> {
    return this.request(`/recipes/${encodeURIComponent(recipeId)}/journey`, {
      method: "PUT",
      body: JSON.stringify(write),
    });
  }
  generate(input: GenerationRequest): Promise<GenerationResult> {
    return this.request("/generate", { method: "POST", body: JSON.stringify(input) });
  }

  async events(
    onEvent: (event: unknown) => void,
    options: { signal?: AbortSignal; onOpen?: () => void } = {},
  ): Promise<void> {
    const headers = new Headers({
      Accept: "text/event-stream",
      "X-Organization-Id": this.connection.organizationId,
      "X-Project-Id": this.connection.projectId,
    });
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
            onEvent(JSON.parse(data));
          } catch {
            /* ignore malformed event */
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}
