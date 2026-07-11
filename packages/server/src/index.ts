/**
 * HTTP + SSE API over @relay/core.
 * Jobs, traces, heal retries, persisted runs/, live capture.
 */
import http from "node:http";
import { URL } from "node:url";
import { assertSafeBinding, authorizationMatches } from "./security.js";
import {
  captureScreenshot,
  captureSnapshot,
  createDevice,
  enqueueJob,
  formatSnapshotTree,
  getActiveJob,
  getJob,
  interact,
  listActionsWithTrace,
  listDevices,
  listJobs,
  listRecipes,
  readRecipe,
  readRecipeEvidenceImage,
  saveRecipe,
  saveRecipeEvidenceImage,
  deleteRecipe,
  runRecipeStep,
  validateRecipeSteps,
  listPersistedRuns,
  now,
  publish,
  readFrameFile,
  readPersistedRun,
  recentEvents,
  retryJob,
  cancelJob,
  pauseJob,
  resumeJob,
  cancelActiveJob,
  runsRoot,
  selectDevice,
  subscribe,
  runDoctor,
  toJobReport,
  toJunitXml,
  type DeviceEvent,
  type InteractInput,
  type JobReport,
  generateValues,
  leaseDevice,
  listBuilds,
  listDeviceLeases,
  listDevicePools,
  listProjects,
  readJourney,
  readProjectVariables,
  releaseDeviceLease,
  saveBuild,
  saveDevicePool,
  saveProject,
  writeJourney,
  writeProjectVariables,
} from "@relay/core";
import { RevisionConflict } from "@relay/protocol";
import type {
  Build,
  DevicePool,
  GenerationRequest,
  JourneyMetadata,
  Project,
  RevisionWrite,
  TestVariable,
} from "@relay/protocol";

export type StartServerOptions = {
  port?: number;
  host?: string;
  token?: string;
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // PUT/DELETE are used by recipe CRUD; browsers preflight them.
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Organization-Id, X-Project-Id, Idempotency-Key",
};

/** Reject oversized bodies early — screenshots/recipe JSON stay well under this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

function text(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

function parseLimit(raw: string | null, fallback: number, max = 200): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function requestScope(req: http.IncomingMessage): { organizationId: string; projectId: string } {
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    organizationId: header("x-organization-id")?.trim() || "local",
    projectId: header("x-project-id")?.trim() || "default",
  };
}

/** In-memory job reports, newest first. Falls back empty when none. */
function collectReports(limit: number): JobReport[] {
  return listJobs(limit).map(toJobReport);
}

function readBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, `Request body too large (max ${maxBytes} bytes)`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        settle(() => reject(new HttpError(413, `Request body too large (max ${maxBytes} bytes)`)));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (err) => settle(() => reject(err)));
  });
}

async function parseJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const raw = await readBody(req, maxBytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ap = pathname.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const p = pp[i]!;
    const a = ap[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return params;
}

type SseClient = { res: http.ServerResponse; id: number };
const sseClients = new Set<SseClient>();
let sseSeq = 0;

function writeSse(res: http.ServerResponse, event: DeviceEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcast(event: DeviceEvent): void {
  for (const client of sseClients) {
    try {
      writeSse(client.res, event);
    } catch {
      sseClients.delete(client);
    }
  }
}

subscribe((event) => broadcast(event));

const serverStartedAt = Date.now();
const PRODUCT_VERSION = "0.1.0";

function attachSse(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...CORS_HEADERS,
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: now() })}\n\n`);
  for (const ev of recentEvents(30)) writeSse(res, ev);

  const client: SseClient = { res, id: ++sseSeq };
  sseClients.add(client);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token?: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (!authorizationMatches(req.headers.authorization, token)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="relay"');
    json(res, 401, { error: "Authentication required" });
    return;
  }

  try {
    const scope = requestScope(req);
    if (method === "GET" && pathname === "/health") {
      let deviceCount: number | null = null;
      try {
        deviceCount = (await listDevices()).length;
      } catch {
        deviceCount = null;
      }
      const active = getActiveJob();
      json(res, 200, {
        ok: true,
        product: "relay",
        version: PRODUCT_VERSION,
        mode: "app-testing",
        at: now(),
        uptimeMs: now() - serverStartedAt,
        activeJob: active
          ? {
              id: active.id,
              action: active.action,
              status: active.status,
              serial: active.serial ?? null,
              deviceName: active.deviceName ?? null,
              startedAt: active.startedAt ?? null,
            }
          : null,
        jobs: listJobs(50).length,
        deviceCount,
        sseClients: sseClients.size,
        runsDir: runsRoot(),
      });
      return;
    }

    if (method === "GET" && pathname === "/events") {
      attachSse(req, res);
      return;
    }

    if (method === "GET" && pathname === "/actions") {
      json(res, 200, { actions: listActionsWithTrace() });
      return;
    }

    if (method === "GET" && pathname === "/devices") {
      const devices = await listDevices();
      json(res, 200, { devices });
      return;
    }

    // ---- Project-scoped control plane ----
    if (method === "GET" && pathname === "/projects") {
      json(res, 200, { projects: await listProjects(scope.organizationId) });
      return;
    }

    if (method === "POST" && pathname === "/projects") {
      const body = (await parseJsonBody(req)) as Partial<Project>;
      if (!body.id?.trim() || !body.name?.trim())
        throw new HttpError(400, "id and name are required");
      const project = await saveProject({
        id: body.id.trim(),
        name: body.name.trim(),
        organizationId: scope.organizationId,
      });
      json(res, 201, { project });
      return;
    }

    if (method === "GET" && pathname === "/builds") {
      json(res, 200, { builds: await listBuilds(scope.projectId) });
      return;
    }

    if (method === "POST" && pathname === "/builds") {
      const body = (await parseJsonBody(req)) as Partial<Build>;
      if (!body.id || !body.name || (body.platform !== "android" && body.platform !== "ios")) {
        throw new HttpError(400, "id, name, and a valid platform are required");
      }
      const build = await saveBuild({
        id: body.id,
        projectId: scope.projectId,
        name: body.name,
        platform: body.platform,
        sourceUrl: body.sourceUrl,
        status: body.status ?? "uploaded",
      });
      json(res, 201, { build });
      return;
    }

    if (method === "GET" && pathname === "/device-pools") {
      json(res, 200, { pools: await listDevicePools(scope.projectId) });
      return;
    }

    if (method === "POST" && pathname === "/device-pools") {
      const body = (await parseJsonBody(req)) as Partial<DevicePool>;
      if (!body.id || !body.name || !Array.isArray(body.deviceSerials)) {
        throw new HttpError(400, "id, name, and deviceSerials are required");
      }
      const pool = await saveDevicePool({
        id: body.id,
        projectId: scope.projectId,
        name: body.name,
        platform: body.platform ?? "mixed",
        deviceSerials: body.deviceSerials.map(String),
      });
      json(res, 201, { pool });
      return;
    }

    if (method === "GET" && pathname === "/device-leases") {
      json(res, 200, { leases: await listDeviceLeases(scope.projectId) });
      return;
    }

    if (method === "POST" && pathname === "/device-leases") {
      const body = (await parseJsonBody(req)) as {
        poolId?: string;
        deviceSerial?: string;
        ownerId?: string;
        expiresAt?: number;
      };
      if (!body.poolId || !body.deviceSerial || !body.ownerId)
        throw new HttpError(400, "poolId, deviceSerial, and ownerId are required");
      const lease = await leaseDevice({
        projectId: scope.projectId,
        poolId: body.poolId,
        deviceSerial: body.deviceSerial,
        ownerId: body.ownerId,
        expiresAt: body.expiresAt ?? now() + 15 * 60_000,
      });
      json(res, 201, { lease });
      return;
    }

    const releaseLeaseMatch = matchPath(pathname, "/device-leases/:id/release");
    if (method === "POST" && releaseLeaseMatch) {
      json(res, 200, { lease: await releaseDeviceLease(releaseLeaseMatch.id!) });
      return;
    }

    if (method === "GET" && pathname === "/project/variables") {
      json(res, 200, await readProjectVariables(scope.projectId));
      return;
    }

    if (method === "PUT" && pathname === "/project/variables") {
      const body = (await parseJsonBody(req)) as RevisionWrite<TestVariable[]>;
      if (!Number.isInteger(body.expectedRevision) || !Array.isArray(body.value)) {
        throw new HttpError(400, "expectedRevision and value are required");
      }
      body.idempotencyKey ||= req.headers["idempotency-key"] as string | undefined;
      json(res, 200, await writeProjectVariables(scope.projectId, body));
      return;
    }

    const journeyMatch = matchPath(pathname, "/recipes/:id/journey");
    if (method === "GET" && journeyMatch) {
      json(res, 200, await readJourney(scope.projectId, journeyMatch.id!));
      return;
    }
    if (method === "PUT" && journeyMatch) {
      const body = (await parseJsonBody(req)) as RevisionWrite<JourneyMetadata>;
      if (
        !Number.isInteger(body.expectedRevision) ||
        !body.value?.positions ||
        !body.value?.edgeLabels ||
        !body.value?.edgeKinds
      ) {
        throw new HttpError(400, "expectedRevision and Journey metadata are required");
      }
      body.idempotencyKey ||= req.headers["idempotency-key"] as string | undefined;
      json(res, 200, await writeJourney(scope.projectId, journeyMatch.id!, body));
      return;
    }

    if (method === "POST" && pathname === "/generate") {
      const body = (await parseJsonBody(req)) as GenerationRequest;
      if (!body.prompt?.trim() || (body.purpose !== "variable" && body.purpose !== "test-plan")) {
        throw new HttpError(400, "purpose and prompt are required");
      }
      json(res, 200, await generateValues(body));
      return;
    }

    if (method === "POST" && pathname === "/device/select") {
      const body = (await parseJsonBody(req)) as { serial?: string | null };
      selectDevice(body.serial ?? null);
      json(res, 200, { ok: true, serial: body.serial ?? null });
      return;
    }

    if (method === "GET" && pathname === "/jobs") {
      const limit = parseLimit(url.searchParams.get("limit"), 50);
      json(res, 200, {
        jobs: listJobs(limit),
        active: getActiveJob(),
      });
      return;
    }

    const jobMatch = matchPath(pathname, "/jobs/:id");
    if (method === "GET" && jobMatch) {
      const job = getJob(jobMatch.id!);
      if (!job) throw new HttpError(404, "Job not found");
      json(res, 200, { job });
      return;
    }

    const retryMatch = matchPath(pathname, "/jobs/:id/retry");
    if (method === "POST" && retryMatch) {
      const job = retryJob(retryMatch.id!);
      json(res, 202, { job });
      return;
    }

    const cancelMatch = matchPath(pathname, "/jobs/:id/cancel");
    if (method === "POST" && cancelMatch) {
      const job = cancelJob(cancelMatch.id!);
      json(res, 200, { job });
      return;
    }

    const pauseMatch = matchPath(pathname, "/jobs/:id/pause");
    if (method === "POST" && pauseMatch) {
      const job = pauseJob(pauseMatch.id!);
      json(res, 200, { job });
      return;
    }

    const resumeMatch = matchPath(pathname, "/jobs/:id/resume");
    if (method === "POST" && resumeMatch) {
      const job = resumeJob(resumeMatch.id!);
      json(res, 200, { job });
      return;
    }

    if (method === "POST" && pathname === "/jobs/active/cancel") {
      const job = cancelActiveJob();
      if (!job) throw new HttpError(404, "No active job");
      json(res, 200, { job });
      return;
    }

    if (method === "POST" && pathname === "/jobs") {
      const body = (await parseJsonBody(req)) as {
        action?: string;
        recipe?: string;
        serial?: string;
        prodAccountMatch?: string;
        retryOf?: string;
        variables?: Record<string, string>;
      };
      if (!body.action && !body.recipe && !body.retryOf) {
        throw new HttpError(400, "action or recipe is required");
      }
      let job;
      try {
        job = body.retryOf
          ? retryJob(body.retryOf)
          : enqueueJob({
              action: body.action,
              recipe: body.recipe,
              serial: body.serial,
              prodAccountMatch: body.prodAccountMatch,
              variables: body.variables,
            });
      } catch (err) {
        // enqueueJob throws "Unknown action: <id>" for bad action ids — surface as 400, not 500.
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
      json(res, 202, { job });
      return;
    }

    // ---- Recipe CRUD ----
    if (method === "GET" && pathname === "/recipes") {
      json(res, 200, { recipes: await listRecipes() });
      return;
    }

    const recipeEvidenceImageMatch = matchPath(pathname, "/recipes/:id/evidence/:evidenceId");
    if (method === "GET" && recipeEvidenceImageMatch) {
      const image = await readRecipeEvidenceImage(
        recipeEvidenceImageMatch.id!,
        recipeEvidenceImageMatch.evidenceId!,
      );
      if (!image) throw new HttpError(404, "Recording evidence not found");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": image.byteLength,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...CORS_HEADERS,
      });
      res.end(image);
      return;
    }

    const recipeEvidenceMatch = matchPath(pathname, "/recipes/:id/evidence");
    if (method === "POST" && recipeEvidenceMatch) {
      const recipe = await readRecipe(recipeEvidenceMatch.id!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      const body = (await parseJsonBody(req, 12 * 1024 * 1024)) as {
        evidenceId?: string;
        mime?: string;
        base64?: string;
      };
      if (!body.evidenceId || body.mime !== "image/png" || !body.base64) {
        throw new HttpError(400, "evidenceId, image/png mime, and base64 are required");
      }
      try {
        const saved = await saveRecipeEvidenceImage({
          recipeId: recipe.id,
          evidenceId: body.evidenceId,
          base64: body.base64,
        });
        json(res, 201, { ok: true, ...saved });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const recipeMatch = matchPath(pathname, "/recipes/:id");
    if (method === "GET" && recipeMatch) {
      const recipe = await readRecipe(recipeMatch.id!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      json(res, 200, { recipe });
      return;
    }

    if (method === "POST" && pathname === "/recipes") {
      const body = (await parseJsonBody(req)) as {
        title?: string;
        description?: string;
        steps?: unknown;
      };
      if (!body.title || !body.title.trim()) throw new HttpError(400, "title is required");
      let steps;
      try {
        steps = validateRecipeSteps(body.steps);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      const recipe = await saveRecipe({
        title: body.title,
        description: body.description,
        steps,
      });
      json(res, 201, { recipe });
      return;
    }

    if (method === "PUT" && recipeMatch) {
      const id = recipeMatch.id!;
      // saveRecipe refuses builtin ids with a clear message.
      const body = (await parseJsonBody(req)) as {
        title?: string;
        description?: string;
        steps?: unknown;
      };
      let steps;
      try {
        steps = validateRecipeSteps(body.steps);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      let recipe;
      try {
        recipe = await saveRecipe({
          id,
          title: body.title ?? id,
          description: body.description,
          steps,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
      json(res, 200, { recipe });
      return;
    }

    if (method === "DELETE" && recipeMatch) {
      try {
        await deleteRecipe(recipeMatch.id!);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
      json(res, 200, { ok: true });
      return;
    }

    const runMatch = matchPath(pathname, "/actions/:id/run");
    if (method === "POST" && runMatch) {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        prodAccountMatch?: string;
        wait?: boolean;
      };
      const job = enqueueJob({
        action: runMatch.id!,
        serial: body.serial,
        prodAccountMatch: body.prodAccountMatch,
      });
      if (body.wait === false) {
        json(res, 202, { job });
        return;
      }
      for (;;) {
        const current = getJob(job.id);
        if (!current) {
          throw new HttpError(500, "Job disappeared while waiting");
        }
        if (
          current.status === "ok" ||
          current.status === "error" ||
          current.status === "healed" ||
          current.status === "cancelled"
        ) {
          json(res, 200, {
            ok: current.status === "ok" || current.status === "healed",
            action: current.action,
            result: current.result,
            error: current.error,
            healed: current.healed,
            healMessage: current.healMessage,
            cancelled: current.status === "cancelled",
            job: current,
            logs: current.logs,
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (method === "GET" && pathname === "/snapshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const interactiveOnly = url.searchParams.get("interactiveOnly") === "1";
      const snap = await captureSnapshot({ serial, interactiveOnly });
      const tree = formatSnapshotTree(snap.nodes);
      json(res, 200, { ...snap, tree });
      return;
    }

    if (method === "GET" && pathname === "/screenshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const caption = url.searchParams.get("caption") ?? undefined;
      const jobId = url.searchParams.get("jobId") ?? undefined;
      const ephemeral = url.searchParams.get("ephemeral") === "1";
      const shot = await captureScreenshot({
        serial,
        caption: caption ?? undefined,
        jobId,
        ephemeral,
      });
      json(res, 200, shot);
      return;
    }

    if (method === "POST" && pathname === "/interact") {
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(400, "body.kind required (label|point|ref|find|text-match|swipe|type)");
      }
      if (getActiveJob()?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      const { serial, ...input } = body;
      await interact(input as InteractInput, { serial });
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/step/run") {
      const body = (await parseJsonBody(req)) as { step?: unknown; serial?: string };
      if (!body || typeof body !== "object" || body.step === undefined) {
        throw new HttpError(400, "body.step is required");
      }
      let steps;
      try {
        steps = validateRecipeSteps([body.step]);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      const step = steps[0]!;
      if (step.kind === "pause") {
        throw new HttpError(400, "pause steps cannot run standalone");
      }
      if (getActiveJob()?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      // No connected device would surface as a confusing step-level failure
      // (e.g. "expect ... not visible") — report it plainly instead.
      let deviceCount = 0;
      try {
        deviceCount = (await listDevices()).length;
      } catch {
        deviceCount = 0;
      }
      if (deviceCount === 0) {
        json(res, 200, { ok: false, error: "No device connected", durationMs: 0, logs: [] });
        return;
      }
      if (body.serial) selectDevice(body.serial);
      const device = createDevice();
      const logs: string[] = [];
      const started = now();
      try {
        await runRecipeStep(device, step, { log: (line) => logs.push(line) });
        json(res, 200, { ok: true, durationMs: now() - started, logs });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 200, { ok: false, error: message, durationMs: now() - started, logs });
      }
      return;
    }

    // persisted runs
    if (method === "GET" && pathname === "/runs") {
      const limit = parseLimit(url.searchParams.get("limit"), 40);
      const runs = await listPersistedRuns(limit);
      json(res, 200, { runs, root: runsRoot() });
      return;
    }

    const persistedMatch = matchPath(pathname, "/runs/:id");
    if (method === "GET" && persistedMatch) {
      const run = await readPersistedRun(persistedMatch.id!);
      if (!run) throw new HttpError(404, "Run not found");
      json(res, 200, { run });
      return;
    }

    // GET /runs/:id/frames/:file
    const frameMatch = matchPath(pathname, "/runs/:id/frames/:file");
    if (method === "GET" && frameMatch) {
      const run = await readPersistedRun(frameMatch.id!);
      if (!run) throw new HttpError(404, "Run not found");
      const buf = await readFrameFile(run.dir, frameMatch.file!);
      if (!buf) throw new HttpError(404, "Frame not found");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": buf.byteLength,
        "Cache-Control": "private, max-age=3600",
        ...CORS_HEADERS,
      });
      res.end(buf);
      return;
    }

    if (method === "GET" && pathname === "/doctor") {
      const result = await runDoctor();
      json(res, result.ok ? 200 : 503, result);
      return;
    }

    // Must be registered before /report/:jobId so "junit" is not treated as an id.
    if (method === "GET" && pathname === "/report/junit") {
      const limit = parseLimit(url.searchParams.get("limit"), 50);
      text(res, 200, toJunitXml(collectReports(limit)), "text/xml; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/report") {
      const limit = parseLimit(url.searchParams.get("limit"), 20);
      json(res, 200, { reports: collectReports(limit) });
      return;
    }

    const reportMatch = matchPath(pathname, "/report/:jobId");
    if (method === "GET" && reportMatch) {
      const job = getJob(reportMatch.jobId!);
      if (!job) throw new HttpError(404, "Job not found");
      json(res, 200, toJobReport(job));
      return;
    }

    if (method === "GET" && pathname === "/meta") {
      json(res, 200, {
        name: "relay",
        description: "Relay mobile app testing server (agent-device)",
        version: PRODUCT_VERSION,
        runsDir: runsRoot(),
        endpoints: [
          "GET /health",
          "GET /doctor",
          "GET /report",
          "GET /report/:jobId",
          "GET /report/junit",
          "GET /events (SSE)",
          "GET /actions",
          "GET /devices",
          "GET/POST /projects",
          "GET/POST /builds",
          "GET/POST /device-pools",
          "GET/POST /device-leases",
          "POST /device-leases/:id/release",
          "GET/PUT /project/variables",
          "GET/PUT /recipes/:id/journey",
          "POST /generate",
          "POST /device/select",
          "GET /jobs",
          "GET /jobs/:id",
          "POST /jobs",
          "POST /jobs/:id/retry",
          "POST /jobs/:id/cancel",
          "POST /jobs/:id/pause",
          "POST /jobs/:id/resume",
          "GET /recipes",
          "GET /recipes/:id",
          "POST /recipes",
          "PUT /recipes/:id",
          "DELETE /recipes/:id",
          "POST /actions/:id/run",
          "GET /snapshot",
          "GET /screenshot",
          "POST /interact",
          "POST /step/run",
          "GET /runs",
          "GET /runs/:id",
          "GET /runs/:id/frames/:file",
        ],
      });
      return;
    }

    json(res, 404, { error: `Not found: ${method} ${pathname}` });
  } catch (err) {
    if (err instanceof RevisionConflict) {
      json(res, 409, { error: err.message, current: err.current });
      return;
    }
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    publish({ type: "error", at: now(), message, where: "server" });
    json(res, 500, { error: message });
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;
  const token = opts.token ?? process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN;
  assertSafeBinding(host, token);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, token);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : preferredPort;
  publish({ type: "server.ready", at: now(), host, port });

  return {
    port,
    host,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const c of sseClients) {
          try {
            c.res.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const tokenIdx = argv.indexOf("--token");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const token =
    tokenIdx >= 0
      ? argv[tokenIdx + 1]
      : (process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN);
  const started = await startServer({ port, host, token });
  console.log(`@relay/server listening on http://${started.host}:${started.port}`);
  console.log(`  runs → ${runsRoot()}`);
}

const invokedDirectly =
  process.argv[1]?.endsWith("/server/src/index.ts") ||
  process.argv[1]?.endsWith("\\server\\src\\index.ts") ||
  process.argv[1]?.includes("@relay/server");

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
