import type http from "node:http";
import {
  authoringSessions,
  deleteRecipe,
  deleteSchedule,
  formatRecipeYaml,
  IdempotencyConflict,
  listAppMaps,
  listRecipeHistory,
  listRecipes,
  listSchedules,
  parseRecipeYaml,
  readAuthoringEvidence,
  readRecipe,
  readRecipeEvidenceImage,
  recipeStability,
  restoreRecipeHistory,
  saveRecipe,
  saveRecipeEvidenceImage,
  saveSchedule,
  validateRecipeSteps,
  type RecipeParameter,
} from "@relay/core";
import { RevisionConflict } from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, text } from "./http.js";
import type { RequestContext } from "./security.js";

type RecipeRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleRecipeRoute(input: RecipeRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;
  if (method === "GET" && pathname === "/recipes") {
    json(response, 200, { recipes: await listRecipes() });
    return true;
  }
  if (method === "GET" && pathname === "/schedules") {
    json(response, 200, {
      schedules: await listSchedules(
        scope.localTrusted ? undefined : { projectId: scope.projectId },
      ),
    });
    return true;
  }
  if (method === "POST" && pathname === "/schedules") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Schedules can only be changed from a local Relay host");
    }
    try {
      const body = (await parseJsonBody(request)) as Parameters<typeof saveSchedule>[0];
      await assertTargetControl(scope, body.targetId);
      json(response, 201, {
        schedule: await saveSchedule({ ...body, projectId: scope.projectId }),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const scheduleMatch = matchPath(pathname, "/schedules/:id");
  if (method === "DELETE" && scheduleMatch) {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Schedules can only be changed from a local Relay host");
    }
    const removed = await deleteSchedule(scheduleMatch.id!, { projectId: scope.projectId });
    if (!removed) throw new HttpError(404, "Schedule not found");
    json(response, 200, { ok: true });
    return true;
  }
  const recipeEvidenceImageMatch = matchPath(pathname, "/recipes/:recipeId/evidence/:evidenceId");
  if (method === "GET" && recipeEvidenceImageMatch) {
    const image = await readRecipeEvidenceImage(
      recipeEvidenceImageMatch.recipeId!,
      recipeEvidenceImageMatch.evidenceId!,
    );
    if (!image) throw new HttpError(404, "Recording evidence not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": image.byteLength,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...CORS_HEADERS,
    });
    response.end(image);
    return true;
  }
  const authoringEvidenceMatch = matchPath(pathname, "/authoring-evidence/:sha256");
  if (method === "GET" && authoringEvidenceMatch) {
    const sha256 = authoringEvidenceMatch.sha256!;
    const uri = `relay-evidence://${sha256}`;
    const sessions = await authoringSessions.list(scope.projectId);
    const permitted =
      sessions.some((session) =>
        session.take?.revisions.some((revision) =>
          revision.evidence.some((evidence) => evidence.uri === uri),
        ),
      ) ||
      sessions.some((session) =>
        session.take?.replayAttempts.some((attempt) =>
          attempt.evidence.some((evidence) => evidence.uri === uri),
        ),
      ) ||
      (await listAppMaps(scope.projectId)).some((appMap) =>
        Object.values(appMap.screenVariants).some(
          (variant) =>
            variant.screenshotUri === uri || variant.evidenceUris?.includes(uri) === true,
        ),
      );
    if (!permitted) throw new HttpError(404, "Authoring evidence not found");
    const artifact = await readAuthoringEvidence(sha256);
    if (!artifact) throw new HttpError(404, "Authoring evidence not found");
    const requestedMime = url.searchParams.get("mime") ?? "";
    const contentType = requestedMime.startsWith("video/")
      ? requestedMime
      : requestedMime === "application/json"
        ? requestedMime
        : "image/png";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": artifact.byteLength,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...CORS_HEADERS,
    });
    response.end(artifact);
    return true;
  }
  const recipeHistoryMatch = matchPath(pathname, "/recipes/:recipeId/history");
  if (method === "GET" && recipeHistoryMatch) {
    json(response, 200, { versions: await listRecipeHistory(recipeHistoryMatch.recipeId!) });
    return true;
  }
  if (method === "POST" && recipeHistoryMatch) {
    const body = (await parseJsonBody(request)) as { updatedAt?: number };
    if (!Number.isFinite(body.updatedAt)) throw new HttpError(400, "updatedAt is required");
    try {
      json(response, 200, {
        recipe: await restoreRecipeHistory(recipeHistoryMatch.recipeId!, body.updatedAt!),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const recipeStabilityMatch = matchPath(pathname, "/recipes/:recipeId/stability");
  if (method === "GET" && recipeStabilityMatch) {
    json(response, 200, { stability: await recipeStability(recipeStabilityMatch.recipeId!) });
    return true;
  }
  const recipeYamlMatch = matchPath(pathname, "/recipes/:recipeId/yaml");
  if (method === "GET" && recipeYamlMatch) {
    const recipe = await readRecipe(recipeYamlMatch.recipeId!);
    if (!recipe) throw new HttpError(404, "Recipe not found");
    const yaml = formatRecipeYaml(recipe);
    if (request.headers.accept?.includes("application/json")) json(response, 200, { yaml });
    else text(response, 200, yaml, "application/yaml; charset=utf-8");
    return true;
  }
  if (method === "POST" && pathname === "/recipes/import") {
    const body = (await parseJsonBody(request)) as {
      yaml?: string;
      dryRun?: boolean;
      conflict?: "reject" | "replace" | "copy";
    };
    if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
    try {
      const parsed = parseRecipeYaml(body.yaml);
      const existing = await readRecipe(parsed.id);
      if (body.dryRun) {
        json(response, 200, {
          preview: {
            recipe: parsed,
            exists: Boolean(existing),
            canonicalYaml: formatRecipeYaml(parsed),
          },
        });
        return true;
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
        expectedRevision: existing && conflict === "replace" ? existing.updatedAt : 0,
        title,
        description: parsed.description,
        variables: parsed.variables,
        parameters: parsed.parameters,
        steps: parsed.steps,
        quarantined: parsed.quarantined,
        quarantineReason: parsed.quarantineReason,
        recordingFormatVersion: parsed.recordingFormatVersion,
      });
      json(response, 201, { recipe });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const recipeEvidenceMatch = matchPath(pathname, "/recipes/:recipeId/evidence");
  if (method === "POST" && recipeEvidenceMatch) {
    const recipe = await readRecipe(recipeEvidenceMatch.recipeId!);
    if (!recipe) throw new HttpError(404, "Recipe not found");
    const body = (await parseJsonBody(request, 12 * 1024 * 1024)) as {
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
      json(response, 201, { ok: true, ...saved });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const recipeMatch = matchPath(pathname, "/recipes/:recipeId");
  if (method === "GET" && recipeMatch) {
    const recipe = await readRecipe(recipeMatch.recipeId!);
    if (!recipe) throw new HttpError(404, "Recipe not found");
    json(response, 200, { recipe });
    return true;
  }
  if (method === "POST" && pathname === "/recipes") {
    const body = (await parseJsonBody(request)) as {
      expectedRevision?: number;
      title?: string;
      description?: string;
      variables?: Record<string, string>;
      parameters?: RecipeParameter[];
      steps?: unknown;
      quarantined?: boolean;
      quarantineReason?: string;
    };
    if (body.expectedRevision !== 0) throw new HttpError(409, "New recipes require revision 0");
    if (!body.title || !body.title.trim()) throw new HttpError(400, "title is required");
    let steps;
    try {
      steps = validateRecipeSteps(body.steps);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    const recipe = await saveRecipe({
      expectedRevision: 0,
      title: body.title,
      description: body.description,
      variables: body.variables,
      parameters: body.parameters,
      steps,
      quarantined: body.quarantined,
      quarantineReason: body.quarantineReason,
    });
    json(response, 201, { recipe });
    return true;
  }
  if (method === "PUT" && recipeMatch) {
    const id = recipeMatch.recipeId!;
    const body = (await parseJsonBody(request)) as {
      expectedRevision?: number;
      title?: string;
      description?: string;
      variables?: Record<string, string>;
      parameters?: RecipeParameter[];
      steps?: unknown;
      quarantined?: boolean;
      quarantineReason?: string;
    };
    if (!Number.isFinite(body.expectedRevision) || body.expectedRevision! < 0) {
      throw new HttpError(400, "expectedRevision is required");
    }
    let steps;
    try {
      steps = validateRecipeSteps(body.steps);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    try {
      const recipe = await saveRecipe({
        id,
        expectedRevision: body.expectedRevision!,
        title: body.title ?? id,
        description: body.description,
        variables: body.variables,
        parameters: body.parameters,
        steps,
        quarantined: body.quarantined,
        quarantineReason: body.quarantineReason,
      });
      json(response, 200, { recipe });
    } catch (error) {
      if (error instanceof RevisionConflict || error instanceof IdempotencyConflict) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  if (method === "DELETE" && recipeMatch) {
    try {
      await deleteRecipe(recipeMatch.recipeId!);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    json(response, 200, { ok: true });
    return true;
  }
  return false;
}
