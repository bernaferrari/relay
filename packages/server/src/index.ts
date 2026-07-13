/**
 * HTTP + SSE API over @relay/core.
 * Jobs, traces, heal retries, persisted runs/, live capture.
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { URL } from "node:url";
import { assertSafeBinding, authorizationMatches } from "./security.js";
import {
  captureScreenshot,
  captureSnapshot,
  createDevice,
  enqueueJob,
  formatSnapshotTree,
  formatRecipeYaml,
  formatMatrixYaml,
  parseMatrixYaml,
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
  runArtifactFile,
  readPersistedRun,
  recentEvents,
  retryJob,
  cancelJob,
  pauseJob,
  parseRecipeYaml,
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
  listCompatibilityMatrices,
  readCompatibilityMatrix,
  listProjects,
  readJourney,
  readProjectVariables,
  releaseDeviceLease,
  saveBuild,
  saveDevicePool,
  saveCompatibilityMatrix,
  saveProject,
  writeJourney,
  writeProjectVariables,
  prepareRunMatrix,
  buildTestAtlas,
  listRecipeHistory,
  restoreRecipeHistory,
  recipeStability,
  listSchedules,
  saveSchedule,
  deleteSchedule,
  markScheduleRun,
  resolveScheduledTargetProfile,
  listTargets,
  readTarget,
  saveBrowserTarget,
  deleteTarget,
  deleteCompatibilityMatrix,
  preflightTarget,
  buildTargetProfiles,
  createDiscoverySession,
  renameDiscoverySession,
  listDiscoverySessions,
  readDiscoverySession,
  readDiscoveryScreenAsset,
  recordObservedScreen,
  recordObservedTransition,
  setDiscoveryStatus,
  formatDiscoveryExport,
  isSensitiveDiscoveryAction,
  promoteDiscoveryPath,
  suggestDiscoveryControl,
  resolveCompatibilityMatrix,
  selectBrowserTarget,
  buildCompatibilityReport,
  buildDiscoveryCoverage,
  type RecipeParameter,
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

function discoveryInteraction(input: InteractInput): {
  kind: "tap" | "type" | "scroll" | "back" | "manual";
  label?: string;
  target?: { ref?: string; label?: string; text?: string; point?: { x: number; y: number } };
  text?: string;
  direction?: "up" | "down";
} {
  switch (input.kind) {
    case "label":
      return { kind: "tap", label: input.label, target: { label: input.label } };
    case "ref":
      return { kind: "tap", label: input.ref, target: { ref: input.ref } };
    case "text-match":
      return { kind: "tap", label: input.match, target: { text: input.match } };
    case "find":
      return { kind: "tap", label: input.query, target: { text: input.query } };
    case "point":
      return {
        kind: "tap",
        label: "Coordinate tap",
        target: { point: { x: input.x, y: input.y } },
      };
    case "swipe":
      return {
        kind: "scroll",
        label: "Swipe",
        direction: input.to.y < input.from.y ? "down" : "up",
      };
    case "type":
      return { kind: "type", label: "Type text", text: input.text };
  }
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
      const mobile = await listDevices().catch(() => []);
      const browsers = (await listTargets()).map((target) => ({
        id: target.id,
        serial: target.id,
        name: target.name,
        kind: "Managed browser",
        booted: true,
        platform: "browser",
        targetKind: "browser",
      }));
      json(res, 200, { devices: [...mobile, ...browsers] });
      return;
    }

    if (method === "GET" && pathname === "/targets") {
      json(res, 200, { targets: await listTargets() });
      return;
    }

    if (method === "POST" && pathname === "/targets") {
      const body = (await parseJsonBody(req)) as {
        id?: string;
        name?: string;
        startUrl?: string;
        executablePath?: string;
        headless?: boolean;
      };
      if (!body.name || !body.startUrl) throw new HttpError(400, "name and startUrl are required");
      json(res, 201, {
        target: await saveBrowserTarget({
          id: body.id,
          name: body.name,
          startUrl: body.startUrl,
          executablePath: body.executablePath,
          headless: body.headless,
        }),
      });
      return;
    }

    const targetMatch = matchPath(pathname, "/targets/:id");
    if (method === "DELETE" && targetMatch) {
      await deleteTarget(targetMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    const targetPreflightMatch = matchPath(pathname, "/targets/:id/preflight");
    if (method === "POST" && targetPreflightMatch) {
      const target = await readTarget(targetPreflightMatch.id!);
      if (!target) throw new HttpError(404, "Target not found");
      json(res, 200, { preflight: await preflightTarget(target) });
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

    if (method === "GET" && pathname === "/target-profiles") {
      const devices = await listDevices().catch(() => []);
      json(res, 200, { profiles: buildTargetProfiles({ devices, targets: await listTargets() }) });
      return;
    }

    if (method === "GET" && pathname === "/discovery") {
      json(res, 200, { sessions: await listDiscoverySessions() });
      return;
    }

    if (method === "POST" && pathname === "/discovery") {
      const body = (await parseJsonBody(req)) as {
        name?: string;
        targetId?: string;
        scope?: import("@relay/protocol").DiscoveryScope;
      };
      if (!body.name || !body.targetId) throw new HttpError(400, "name and targetId are required");
      const profiles = buildTargetProfiles({
        devices: await listDevices().catch(() => []),
        targets: await listTargets(),
      });
      const session = await createDiscoverySession({
        name: body.name,
        targetId: body.targetId,
        targetProfile: profiles.find((profile) => profile.targetId === body.targetId),
        scope: body.scope,
      });
      json(res, 201, { session });
      return;
    }

    const discoveryRenameMatch = matchPath(pathname, "/discovery/:id/name");
    if (method === "POST" && discoveryRenameMatch) {
      const body = (await parseJsonBody(req)) as { name?: string };
      if (!body.name?.trim()) throw new HttpError(400, "name is required");
      json(res, 200, {
        session: await renameDiscoverySession(discoveryRenameMatch.id!, body.name),
      });
      return;
    }

    const discoveryMatch = matchPath(pathname, "/discovery/:id");
    if (method === "GET" && discoveryMatch) {
      const session = await readDiscoverySession(discoveryMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { session });
      return;
    }

    const discoveryStatusMatch = matchPath(pathname, "/discovery/:id/status");
    if (method === "POST" && discoveryStatusMatch) {
      const body = (await parseJsonBody(req)) as {
        status?: import("@relay/protocol").DiscoveryStatus;
      };
      if (!body.status) throw new HttpError(400, "status is required");
      json(res, 200, { session: await setDiscoveryStatus(discoveryStatusMatch.id!, body.status) });
      return;
    }

    const discoverySuggestionMatch = matchPath(pathname, "/discovery/:id/suggestion");
    if (method === "GET" && discoverySuggestionMatch) {
      const session = await readDiscoverySession(discoverySuggestionMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { suggestion: suggestDiscoveryControl(session) });
      return;
    }

    const discoveryCoverageMatch = matchPath(pathname, "/discovery/:id/coverage");
    if (method === "GET" && discoveryCoverageMatch) {
      const session = await readDiscoverySession(discoveryCoverageMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { coverage: buildDiscoveryCoverage(session, await listDiscoverySessions()) });
      return;
    }

    const discoveryCaptureMatch = matchPath(pathname, "/discovery/:id/capture");
    if (method === "POST" && discoveryCaptureMatch) {
      const session = await readDiscoverySession(discoveryCaptureMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      const snap = await captureSnapshot({ serial: session.targetId });
      const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const captured = await recordObservedScreen({
        sessionId: session.id,
        nodes: snap.nodes,
        screenshotPath: shot.path,
        makeCurrent: true,
      });
      json(res, 201, { screen: captured.screen, isNew: captured.isNew, session: captured.session });
      return;
    }

    const discoveryInteractMatch = matchPath(pathname, "/discovery/:id/interact");
    if (method === "POST" && discoveryInteractMatch) {
      const session = await readDiscoverySession(discoveryInteractMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      if (session.status !== "running") {
        throw new HttpError(409, "Start or resume this Discovery Map before interacting");
      }
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(400, "body.kind required for Discovery Map interaction");
      }
      const { serial: _serial, ...raw } = body;
      const input = raw as InteractInput;
      const observed = discoveryInteraction(input);
      if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(observed)) {
        throw new HttpError(403, "Discovery policy blocks this sensitive interaction");
      }
      const beforeSnapshot = await captureSnapshot({ serial: session.targetId });
      const beforeShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const before = await recordObservedScreen({
        sessionId: session.id,
        nodes: beforeSnapshot.nodes,
        screenshotPath: beforeShot.path,
        makeCurrent: true,
      });
      await interact(input, { serial: session.targetId });
      const afterSnapshot = await captureSnapshot({ serial: session.targetId });
      const afterShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const after = await recordObservedScreen({
        sessionId: session.id,
        nodes: afterSnapshot.nodes,
        screenshotPath: afterShot.path,
        makeCurrent: true,
      });
      const transition = await recordObservedTransition({
        sessionId: session.id,
        fromScreenId: before.screen.id,
        ...(before.screen.id !== after.screen.id ? { toScreenId: after.screen.id } : {}),
        ...observed,
        changedScreen: before.screen.id !== after.screen.id,
      });
      json(res, 201, { transition, before: before.screen, after: after.screen });
      return;
    }

    const discoveryScreenMatch = matchPath(pathname, "/discovery/:id/screens/:screenId");
    if (method === "GET" && discoveryScreenMatch) {
      const asset = await readDiscoveryScreenAsset(
        discoveryScreenMatch.id!,
        discoveryScreenMatch.screenId!,
      );
      if (!asset) throw new HttpError(404, "Discovery screenshot not found");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": asset.byteLength,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...CORS_HEADERS,
      });
      res.end(asset);
      return;
    }

    const discoveryPromoteMatch = matchPath(pathname, "/discovery/:id/promote");
    if (method === "POST" && discoveryPromoteMatch) {
      const body = (await parseJsonBody(req)) as {
        transitionIds?: string[];
        recipeId?: string;
        title?: string;
        description?: string;
        transitionLabels?: Record<string, string>;
      };
      if (!Array.isArray(body.transitionIds) || !body.recipeId || !body.title) {
        throw new HttpError(400, "transitionIds, recipeId, and title are required");
      }
      try {
        const promoted = await promoteDiscoveryPath({
          sessionId: discoveryPromoteMatch.id!,
          transitionIds: body.transitionIds,
          recipeId: body.recipeId,
          title: body.title,
          description: body.description,
          transitionLabels: body.transitionLabels,
        });
        json(res, 201, promoted);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const discoveryExportMatch = matchPath(pathname, "/discovery/:id/export");
    if (method === "GET" && discoveryExportMatch) {
      const session = await readDiscoverySession(discoveryExportMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";
      text(
        res,
        200,
        formatDiscoveryExport(session, format),
        format === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
      );
      return;
    }

    if (method === "GET" && pathname === "/matrices") {
      json(res, 200, { matrices: await listCompatibilityMatrices(scope.projectId) });
      return;
    }

    const matrixYamlMatch = matchPath(pathname, "/matrices/:id/yaml");
    if (method === "GET" && matrixYamlMatch) {
      const matrix = await readCompatibilityMatrix(scope.projectId, matrixYamlMatch.id!);
      if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
      json(res, 200, { yaml: formatMatrixYaml(matrix) });
      return;
    }

    if (method === "POST" && pathname === "/matrices/import") {
      const body = (await parseJsonBody(req)) as {
        yaml?: string;
        conflict?: "reject" | "replace";
      };
      if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
      let parsed;
      try {
        parsed = parseMatrixYaml(body.yaml, {
          projectId: scope.projectId,
          createdAt: 0,
          updatedAt: 0,
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const existing = await readCompatibilityMatrix(scope.projectId, parsed.id);
      if (existing && body.conflict !== "replace") {
        throw new HttpError(409, `Compatibility matrix “${parsed.id}” already exists`);
      }
      const matrix = await saveCompatibilityMatrix({
        id: parsed.id,
        projectId: scope.projectId,
        name: parsed.name,
        selectors: parsed.selectors,
      });
      json(res, existing ? 200 : 201, { matrix });
      return;
    }

    if (method === "POST" && pathname === "/matrices") {
      const body = (await parseJsonBody(req)) as {
        id?: string;
        name?: string;
        selectors?: import("@relay/protocol").TargetSelector[];
      };
      if (!body.id || !body.name || !Array.isArray(body.selectors)) {
        throw new HttpError(400, "id, name, and selectors are required");
      }
      try {
        const matrix = await saveCompatibilityMatrix({
          id: body.id,
          projectId: scope.projectId,
          name: body.name,
          selectors: body.selectors,
        });
        json(res, 201, { matrix });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const matrixMatch = matchPath(pathname, "/matrices/:id");
    if (method === "PUT" && matrixMatch) {
      const existing = await readCompatibilityMatrix(scope.projectId, matrixMatch.id!);
      if (!existing) throw new HttpError(404, "Compatibility matrix not found");
      const body = (await parseJsonBody(req)) as {
        name?: string;
        selectors?: import("@relay/protocol").TargetSelector[];
      };
      try {
        const matrix = await saveCompatibilityMatrix({
          id: existing.id,
          projectId: scope.projectId,
          name: body.name ?? existing.name,
          selectors: body.selectors ?? existing.selectors,
        });
        json(res, 200, { matrix });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (method === "DELETE" && matrixMatch) {
      await deleteCompatibilityMatrix(scope.projectId, matrixMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    const matrixResolveMatch = matchPath(pathname, "/matrices/:id/resolve");
    if (method === "POST" && matrixResolveMatch) {
      const matrix = await readCompatibilityMatrix(scope.projectId, matrixResolveMatch.id!);
      if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
      const devices = await listDevices().catch(() => []);
      json(res, 200, {
        expansion: resolveCompatibilityMatrix(
          matrix,
          buildTargetProfiles({ devices, targets: await listTargets() }),
        ),
      });
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
      const body = (await parseJsonBody(req)) as {
        serial?: string | null;
        platform?: "android" | "ios" | "browser";
      };
      if (body.platform === "browser") selectBrowserTarget(body.serial ?? null);
      else selectDevice(body.serial ?? null, body.platform ?? "android");
      json(res, 200, {
        ok: true,
        serial: body.serial ?? null,
        platform: body.platform ?? "android",
      });
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

    if (method === "POST" && pathname === "/jobs/matrix") {
      const body = (await parseJsonBody(req)) as {
        recipe?: string;
        serial?: string;
        platform?: "android" | "ios";
        targetKind?: "device" | "browser";
        browserTargetId?: string;
        prodAccountMatch?: string;
        repetitions?: number;
        seed?: number;
        projectId?: string;
      };
      if (!body.recipe) throw new HttpError(400, "recipe is required");
      const definitions = await readProjectVariables(body.projectId?.trim() || "default");
      const matrix = await prepareRunMatrix({
        variables: definitions.value,
        repetitions: body.repetitions,
        seed: body.seed,
      });
      const jobs = matrix.cases.map((item) =>
        enqueueJob({
          recipe: body.recipe,
          serial: body.serial,
          platform: body.platform,
          targetKind: body.targetKind,
          browserTargetId: body.browserTargetId,
          prodAccountMatch: body.prodAccountMatch,
          variables: item.values,
          batchId: matrix.id,
          caseIndex: item.index,
          caseCount: matrix.cases.length,
          artifacts: [
            {
              kind: "frozen-inputs",
              capturedAt: matrix.createdAt,
              data: {
                matrixId: matrix.id,
                seed: matrix.seed,
                caseIndex: item.index,
                caseCount: matrix.cases.length,
                values: item.values,
                provenance: item.provenance,
              },
            },
          ],
        }),
      );
      json(res, 202, { matrix, jobs });
      return;
    }

    if (method === "POST" && pathname === "/jobs/compatibility-matrix") {
      const body = (await parseJsonBody(req)) as {
        recipe?: string;
        matrixId?: string;
        repetitions?: number;
        prodAccountMatch?: string;
      };
      if (!body.recipe || !body.matrixId) {
        throw new HttpError(400, "recipe and matrixId are required");
      }
      const matrix = await readCompatibilityMatrix(scope.projectId, body.matrixId);
      if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
      const profiles = buildTargetProfiles({
        devices: await listDevices().catch(() => []),
        targets: await listTargets(),
      });
      const expansion = resolveCompatibilityMatrix(matrix, profiles);
      if (expansion.profiles.length === 0) {
        const details = expansion.excluded.map((item) => item.reason).join("; ");
        throw new HttpError(
          400,
          `Compatibility matrix “${matrix.name}” matched no targets${details ? ` (${details})` : ""}`,
        );
      }
      const repetitions = Math.min(Math.max(Math.floor(body.repetitions ?? 1), 1), 20);
      const batchId = `compatibility-${matrix.id}-${now()}`;
      const jobs = expansion.profiles.flatMap((profile) =>
        Array.from({ length: repetitions }, (_, repetition) =>
          enqueueJob({
            recipe: body.recipe,
            serial: profile.targetId,
            platform: profile.platform === "ios" ? "ios" : "android",
            targetKind: profile.source === "browser" ? "browser" : "device",
            ...(profile.source === "browser" ? { browserTargetId: profile.targetId } : {}),
            targetProfile: profile,
            prodAccountMatch: body.prodAccountMatch,
            batchId,
            caseIndex: repetition,
            caseCount: repetitions,
            artifacts: [
              {
                kind: "compatibility-profile",
                capturedAt: expansion.resolvedAt,
                data: { matrixId: matrix.id, matrixName: matrix.name, profile },
              },
            ],
          }),
        ),
      );
      json(res, 202, { matrix: expansion, jobs });
      return;
    }

    if (method === "POST" && pathname === "/jobs") {
      const body = (await parseJsonBody(req)) as {
        action?: string;
        recipe?: string;
        serial?: string;
        platform?: "android" | "ios";
        targetKind?: "device" | "browser";
        browserTargetId?: string;
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
              platform: body.platform,
              targetKind: body.targetKind,
              browserTargetId: body.browserTargetId,
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

    if (method === "GET" && pathname === "/atlas") {
      json(res, 200, { atlas: buildTestAtlas(await listRecipes()) });
      return;
    }

    if (method === "GET" && pathname === "/schedules") {
      json(res, 200, { schedules: await listSchedules() });
      return;
    }
    if (method === "POST" && pathname === "/schedules") {
      try {
        const body = (await parseJsonBody(req)) as Parameters<typeof saveSchedule>[0];
        json(res, 201, { schedule: await saveSchedule(body) });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const scheduleMatch = matchPath(pathname, "/schedules/:id");
    if (method === "DELETE" && scheduleMatch) {
      await deleteSchedule(scheduleMatch.id!);
      json(res, 200, { ok: true });
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

    const recipeHistoryMatch = matchPath(pathname, "/recipes/:id/history");
    if (method === "GET" && recipeHistoryMatch) {
      json(res, 200, { versions: await listRecipeHistory(recipeHistoryMatch.id!) });
      return;
    }
    if (method === "POST" && recipeHistoryMatch) {
      const body = (await parseJsonBody(req)) as { updatedAt?: number };
      if (!Number.isFinite(body.updatedAt)) throw new HttpError(400, "updatedAt is required");
      try {
        json(res, 200, {
          recipe: await restoreRecipeHistory(recipeHistoryMatch.id!, body.updatedAt!),
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const recipeStabilityMatch = matchPath(pathname, "/recipes/:id/stability");
    if (method === "GET" && recipeStabilityMatch) {
      json(res, 200, { stability: await recipeStability(recipeStabilityMatch.id!) });
      return;
    }

    const recipeYamlMatch = matchPath(pathname, "/recipes/:id/yaml");
    if (method === "GET" && recipeYamlMatch) {
      const recipe = await readRecipe(recipeYamlMatch.id!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      const yaml = formatRecipeYaml(recipe);
      // The HTTP API defaults to JSON while direct links, curl, and Git tooling
      // receive the portable source file. Keeping both forms at one address
      // avoids an app-only serialization format.
      if (req.headers.accept?.includes("application/json")) json(res, 200, { yaml });
      else text(res, 200, yaml, "application/yaml; charset=utf-8");
      return;
    }

    if (method === "POST" && pathname === "/recipes/import") {
      const body = (await parseJsonBody(req)) as {
        yaml?: string;
        dryRun?: boolean;
        conflict?: "reject" | "replace" | "copy";
      };
      if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
      try {
        const parsed = parseRecipeYaml(body.yaml);
        const existing = await readRecipe(parsed.id);
        if (body.dryRun) {
          json(res, 200, {
            preview: {
              recipe: parsed,
              exists: Boolean(existing),
              canonicalYaml: formatRecipeYaml(parsed),
            },
          });
          return;
        }
        const conflict = body.conflict ?? "reject";
        if (existing && conflict === "reject") {
          throw new HttpError(409, `Test “${parsed.id}” already exists`);
        }
        let id = parsed.id;
        let title = parsed.title;
        if (existing && conflict === "copy") {
          let suffix = 2;
          while (await readRecipe(`${parsed.id}-copy-${suffix}`)) suffix += 1;
          id = `${parsed.id}-copy-${suffix}`;
          title = `${parsed.title} copy`;
        }
        const recipe = await saveRecipe({
          id,
          title,
          description: parsed.description,
          variables: parsed.variables,
          parameters: parsed.parameters,
          steps: parsed.steps,
          quarantined: parsed.quarantined,
          quarantineReason: parsed.quarantineReason,
        });
        json(res, 201, { recipe });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
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
        variables?: Record<string, string>;
        parameters?: RecipeParameter[];
        steps?: unknown;
        quarantined?: boolean;
        quarantineReason?: string;
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
        variables: body.variables,
        parameters: body.parameters,
        steps,
        quarantined: body.quarantined,
        quarantineReason: body.quarantineReason,
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
        variables?: Record<string, string>;
        parameters?: RecipeParameter[];
        steps?: unknown;
        quarantined?: boolean;
        quarantineReason?: string;
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
          variables: body.variables,
          parameters: body.parameters,
          steps,
          quarantined: body.quarantined,
          quarantineReason: body.quarantineReason,
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
        platform?: "android" | "ios";
        prodAccountMatch?: string;
        wait?: boolean;
      };
      const job = enqueueJob({
        action: runMatch.id!,
        serial: body.serial,
        platform: body.platform,
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
    const matrixReportMatch = matchPath(pathname, "/reports/matrix/:batchId");
    if (method === "GET" && matrixReportMatch) {
      const persisted = await listPersistedRuns(500);
      const live = listJobs(500);
      const byId = new Map([...persisted, ...live].map((run) => [run.id, run]));
      const report = buildCompatibilityReport([...byId.values()], matrixReportMatch.batchId!);
      if (!report) throw new HttpError(404, "Compatibility matrix report not found");
      json(res, 200, { report });
      return;
    }
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

    // GET /runs/:id/video/:file — byte ranges keep replay seeking instant.
    const videoMatch = matchPath(pathname, "/runs/:id/video/:file");
    if (method === "GET" && videoMatch) {
      const run = await readPersistedRun(videoMatch.id!);
      if (!run) throw new HttpError(404, "Run not found");
      const file = runArtifactFile(run.dir, "video", videoMatch.file!);
      if (!file) throw new HttpError(404, "Video not found");
      await streamVideo(req, res, file);
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
          "GET /reports/matrix/:batchId",
          "GET /events (SSE)",
          "GET /actions",
          "GET /devices",
          "GET/POST /projects",
          "GET/POST /builds",
          "GET/POST /device-pools",
          "GET /matrices",
          "GET /matrices/:id/yaml",
          "POST /matrices/import",
          "GET/POST /device-leases",
          "POST /device-leases/:id/release",
          "GET/PUT /project/variables",
          "GET/PUT /recipes/:id/journey",
          "POST /generate",
          "POST /device/select",
          "GET /jobs",
          "GET /jobs/:id",
          "POST /jobs",
          "POST /jobs/matrix",
          "POST /jobs/compatibility-matrix",
          "POST /jobs/:id/retry",
          "POST /jobs/:id/cancel",
          "POST /jobs/:id/pause",
          "POST /jobs/:id/resume",
          "GET /recipes",
          "GET /atlas",
          "GET/POST /schedules",
          "DELETE /schedules/:id",
          "GET /recipes/:id",
          "GET/POST /recipes/:id/history",
          "GET /recipes/:id/stability",
          "GET /discovery/:id/coverage",
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
          "GET /runs/:id/video/:file",
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

async function streamVideo(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, "Video not found");
  }
  const total = info.size;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const requestedStart = range?.[1] ? Number(range[1]) : 0;
  const requestedEnd = range?.[2] ? Number(range[2]) : total - 1;
  const start = Math.max(0, Math.min(requestedStart, total - 1));
  const end = Math.max(start, Math.min(requestedEnd, total - 1));
  const partial = Boolean(range);

  res.writeHead(partial ? 206 : 200, {
    "Content-Type": file.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    "Cache-Control": "private, max-age=3600",
    ...CORS_HEADERS,
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { start, end });
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;
  const token = opts.token ?? process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN;
  assertSafeBinding(host, token);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, token);
  });
  let checkingSchedules = false;
  const scheduleTimer = setInterval(() => {
    if (checkingSchedules) return;
    checkingSchedules = true;
    void runDueSchedules().finally(() => {
      checkingSchedules = false;
    });
  }, 30_000);
  scheduleTimer.unref?.();

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
        clearInterval(scheduleTimer);
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

async function runDueSchedules(at = Date.now()): Promise<void> {
  const schedules = await listSchedules();
  // Capture target facts once per tick. Each job/report keeps this immutable
  // observation instead of resolving a potentially different target later.
  const targetProfiles = buildTargetProfiles({
    devices: await listDevices().catch(() => []),
    targets: await listTargets(),
    observedAt: at,
  });
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.nextRunAt > at) continue;
    const recipe = await readRecipe(schedule.recipeId);
    // Mark first so a broken definition cannot hot-loop every scheduler tick.
    await markScheduleRun(schedule.id, at);
    if (!recipe || recipe.quarantined) continue;
    const variables = await readProjectVariables(schedule.projectId);
    const matrix = await prepareRunMatrix({
      variables: variables.value,
      repetitions: schedule.repetitions,
      seed: at,
    });
    const targetProfile = resolveScheduledTargetProfile(schedule, targetProfiles);
    for (const item of matrix.cases) {
      enqueueJob({
        recipe: schedule.recipeId,
        ...(schedule.targetKind === "browser"
          ? { targetKind: "browser" as const, browserTargetId: schedule.targetId }
          : {
              targetKind: "device" as const,
              serial: schedule.targetId,
              platform: schedule.platform === "ios" ? "ios" : "android",
            }),
        variables: item.values,
        ...(targetProfile ? { targetProfile } : {}),
        batchId: matrix.id,
        caseIndex: item.index,
        caseCount: matrix.cases.length,
        artifacts: [
          {
            kind: "schedule",
            capturedAt: at,
            data: {
              scheduleId: schedule.id,
              matrixId: matrix.id,
              provenance: item.provenance,
              targetProfile: targetProfile ?? null,
              targetProfileStatus: targetProfile ? "observed" : "unavailable",
            },
          },
        ],
      });
    }
  }
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
