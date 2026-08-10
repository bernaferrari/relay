import type http from "node:http";
import {
  analyzeCorpus,
  buildCorpusCoverage,
  buildTargetProfiles,
  cancelCorpusSession,
  createCorpusSession,
  exportCorpusPack,
  formatCorpusExport,
  corpusScopeFromLanguageProfile,
  listDevices,
  listCorpusSessions,
  listLanguageProfiles,
  listTargets,
  saveLanguageProfile,
  scanAppLanguagePicker,
  listSwitcherProfiles,
  saveSwitcherProfile,
  scanSwitcherPicker,
  readCorpusScreenAsset,
  readCorpusSession,
  renameCorpusSession,
  setCorpusStatus,
  startCorpusSession,
} from "@relay/core";
import type { CorpusScope, CorpusStatus } from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, text } from "./http.js";
import type { RequestContext } from "./security.js";

type CorpusRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function projectFilter(scope: RequestContext): { projectId: string } | undefined {
  return scope.localTrusted ? undefined : { projectId: scope.projectId };
}

async function loadScopedSession(id: string, scope: RequestContext) {
  const session = await readCorpusSession(id, projectFilter(scope));
  if (!session) throw new HttpError(404, "Corpus session not found");
  return session;
}

export async function handleCorpusRoute(input: CorpusRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;

  if (method === "GET" && pathname === "/corpus") {
    json(response, 200, { sessions: await listCorpusSessions(projectFilter(scope)) });
    return true;
  }

  if (method === "POST" && pathname === "/corpus") {
    const body = (await parseJsonBody(request)) as {
      name?: string;
      targetId?: string;
      scope?: Partial<CorpusScope> & { languageProfileId?: string; switcherProfileId?: string };
    };
    if (!body.name || !body.targetId) throw new HttpError(400, "name and targetId are required");
    const profiles = buildTargetProfiles({
      devices: await listDevices().catch(() => []),
      targets: await listTargets(),
    });
    let corpusScope = body.scope;
    const profileId =
      body.scope?.switcherProfileId?.trim() || body.scope?.languageProfileId?.trim();
    if (profileId) {
      const locales = body.scope?.locales?.length ? body.scope.locales : ["en"];
      const {
        languageProfileId: _a,
        switcherProfileId: _b,
        ...rest
      } = (body.scope ?? {}) as Record<string, unknown>;
      corpusScope = {
        ...(await corpusScopeFromLanguageProfile(String(profileId), locales)),
        ...(rest as Partial<CorpusScope>),
        locales,
      };
    }
    const session = await createCorpusSession({
      name: body.name,
      targetId: body.targetId,
      targetProfile: profiles.find((profile) => profile.targetId === body.targetId),
      scope: corpusScope,
      projectId: scope.projectId,
      organizationId: scope.organizationId,
    });
    json(response, 201, { session });
    return true;
  }

  if (method === "GET" && pathname === "/switcher-profiles") {
    const kind = url.searchParams.get("kind") ?? undefined;
    const app = url.searchParams.get("app") ?? undefined;
    json(response, 200, {
      profiles: await listSwitcherProfiles({
        ...(kind
          ? {
              kind: kind as
                | "language"
                | "account"
                | "environment"
                | "theme"
                | "workspace"
                | "build"
                | "custom",
            }
          : {}),
        ...(app ? { app } : {}),
      }),
    });
    return true;
  }

  if (method === "POST" && pathname === "/switcher-profiles") {
    const body = (await parseJsonBody(request)) as {
      profile?: Parameters<typeof saveSwitcherProfile>[0];
    };
    if (!body.profile) throw new HttpError(400, "profile is required");
    try {
      json(response, 200, { profile: await saveSwitcherProfile(body.profile) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (method === "POST" && pathname === "/switcher-profiles/scan") {
    const body = (await parseJsonBody(request)) as {
      serial?: string;
      app?: string;
      kind?: "language" | "account" | "environment" | "theme" | "workspace" | "build" | "custom";
      profileId?: string;
      name?: string;
      maxScrolls?: number;
      save?: boolean;
      entryPath?: unknown;
      pickerPath?: unknown;
    };
    if (!body.serial?.trim()) throw new HttpError(400, "serial is required");
    if (!body.app?.trim()) throw new HttpError(400, "app is required");
    if (!body.kind)
      throw new HttpError(
        400,
        "kind is required (language | account | environment | theme | workspace | build | custom)",
      );
    await assertTargetControl(scope, body.serial);
    try {
      const result = await scanSwitcherPicker({
        serial: body.serial.trim(),
        app: body.app.trim(),
        kind: body.kind,
        ...(body.profileId ? { profileId: body.profileId } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.maxScrolls !== undefined ? { maxScrolls: body.maxScrolls } : {}),
        save: body.save !== false,
        ...(Array.isArray(body.entryPath) ? { entryPath: body.entryPath as never } : {}),
        ...(Array.isArray(body.pickerPath) ? { pickerPath: body.pickerPath as never } : {}),
      });
      json(response, 200, result);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (method === "GET" && pathname === "/language-profiles") {
    json(response, 200, { profiles: await listLanguageProfiles() });
    return true;
  }

  if (method === "POST" && pathname === "/language-profiles") {
    const body = (await parseJsonBody(request)) as {
      profile?: Parameters<typeof saveLanguageProfile>[0];
    };
    if (!body.profile) throw new HttpError(400, "profile is required");
    try {
      json(response, 200, { profile: await saveLanguageProfile(body.profile) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (method === "POST" && pathname === "/language-profiles/scan") {
    const body = (await parseJsonBody(request)) as {
      serial?: string;
      app?: string;
      profileId?: string;
      name?: string;
      maxScrolls?: number;
      save?: boolean;
    };
    if (!body.serial?.trim()) throw new HttpError(400, "serial is required");
    if (!body.app?.trim()) throw new HttpError(400, "app is required");
    await assertTargetControl(scope, body.serial);
    try {
      const result = await scanAppLanguagePicker({
        serial: body.serial.trim(),
        app: body.app.trim(),
        ...(body.profileId ? { profileId: body.profileId } : { profileId: "grok-ios" }),
        ...(body.name ? { name: body.name } : {}),
        ...(body.maxScrolls !== undefined ? { maxScrolls: body.maxScrolls } : {}),
        save: body.save !== false,
      });
      json(response, 200, result);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const renameMatch = matchPath(pathname, "/corpus/:id/name");
  if (method === "POST" && renameMatch) {
    const body = (await parseJsonBody(request)) as { name?: string };
    if (!body.name?.trim()) throw new HttpError(400, "name is required");
    await loadScopedSession(renameMatch.id!, scope);
    json(response, 200, { session: await renameCorpusSession(renameMatch.id!, body.name) });
    return true;
  }

  const getMatch = matchPath(pathname, "/corpus/:id");
  if (method === "GET" && getMatch) {
    const session = await loadScopedSession(getMatch.id!, scope);
    json(response, 200, { session });
    return true;
  }

  const statusMatch = matchPath(pathname, "/corpus/:id/status");
  if (method === "POST" && statusMatch) {
    const body = (await parseJsonBody(request)) as { status?: CorpusStatus };
    if (!body.status) throw new HttpError(400, "status is required");
    await loadScopedSession(statusMatch.id!, scope);
    try {
      json(response, 200, { session: await setCorpusStatus(statusMatch.id!, body.status) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const startMatch = matchPath(pathname, "/corpus/:id/start");
  if (method === "POST" && startMatch) {
    const session = await loadScopedSession(startMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    try {
      json(response, 202, { session: await startCorpusSession(startMatch.id!) });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const cancelMatch = matchPath(pathname, "/corpus/:id/cancel");
  if (method === "POST" && cancelMatch) {
    await loadScopedSession(cancelMatch.id!, scope);
    json(response, 200, { session: await cancelCorpusSession(cancelMatch.id!) });
    return true;
  }

  const coverageMatch = matchPath(pathname, "/corpus/:id/coverage");
  if (method === "GET" && coverageMatch) {
    const session = await loadScopedSession(coverageMatch.id!, scope);
    json(response, 200, { coverage: buildCorpusCoverage(session) });
    return true;
  }

  const analysisMatch = matchPath(pathname, "/corpus/:id/analysis");
  if (method === "GET" && analysisMatch) {
    const session = await loadScopedSession(analysisMatch.id!, scope);
    json(response, 200, { analysis: analyzeCorpus(session) });
    return true;
  }

  const exportMatch = matchPath(pathname, "/corpus/:id/export");
  if (method === "GET" && exportMatch) {
    const session = await loadScopedSession(exportMatch.id!, scope);
    const format = url.searchParams.get("format");
    if (format === "pack") {
      try {
        const exported = await exportCorpusPack(session.id);
        json(response, 200, {
          session: exported.session,
          manifest: exported.manifest,
          rootDir: exported.rootDir,
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return true;
    }
    const textFormat = format === "markdown" ? "markdown" : "json";
    text(
      response,
      200,
      formatCorpusExport(session, textFormat),
      textFormat === "markdown"
        ? "text/markdown; charset=utf-8"
        : "application/json; charset=utf-8",
    );
    return true;
  }

  const screenMatch = matchPath(pathname, "/corpus/:id/screens/:screenId");
  if (method === "GET" && screenMatch) {
    await loadScopedSession(screenMatch.id!, scope);
    const asset = await readCorpusScreenAsset(screenMatch.id!, screenMatch.screenId!);
    if (!asset) throw new HttpError(404, "Corpus screenshot not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": asset.byteLength,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...CORS_HEADERS,
    });
    response.end(asset);
    return true;
  }

  return false;
}
