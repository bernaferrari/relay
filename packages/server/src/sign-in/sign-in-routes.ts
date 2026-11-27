import {
  checkSavedSignInResolution,
  currentOperationContext,
  listSavedSignIns,
  revokeSavedSignIn,
  rotateSavedSignIn,
  saveSavedSignIn,
  SavedSignInStoreError,
} from "@relay/core";
import { savedSignInOperationInputSchemas } from "@relay/protocol";
import { HttpError, json, parseJsonBody } from "../http.js";
import type { ServerRouteInput } from "../server-route-input.js";

function requireHumanSavedSignInReview(): { actorId: string } {
  const operation = currentOperationContext();
  if (!operation || operation.actorKind !== "human") {
    throw new HttpError(403, "Saved sign-in changes require a human reviewer", {
      code: "HUMAN_REVIEW_REQUIRED",
      recovery: "Ask a person to save, rotate, or revoke the saved sign-in.",
    });
  }
  return { actorId: operation.actorId };
}

function savedSignInConflict(error: unknown): never {
  if (error instanceof SavedSignInStoreError) {
    throw new HttpError(409, error.message, {
      code: `SAVED_SIGN_IN_${error.code.replaceAll("-", "_").toUpperCase()}`,
      recovery:
        error.code === "exists"
          ? "Use relay sign-in rotate for the existing saved sign-in, or choose a different key."
          : "Review the saved sign-in metadata and try again as a person.",
    });
  }
  throw error;
}

/** Project-scoped saved sign-ins. Mutation is human-only; the only read shape
 * is metadata. There is intentionally no secret export route. */
export async function handleSavedSignInRoute(input: ServerRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;
  if (pathname !== "/sign-ins" && !pathname.startsWith("/sign-ins/")) return false;

  if (method === "GET" && pathname === "/sign-ins") {
    const body = savedSignInOperationInputSchemas["sign-in.list"].parse({
      ...(url.searchParams.get("appMapId") ? { appMapId: url.searchParams.get("appMapId") } : {}),
      ...(url.searchParams.get("key") ? { key: url.searchParams.get("key") } : {}),
    });
    json(response, 200, {
      signIns: await listSavedSignIns({
        projectId: scope.projectId,
        ...(body.appMapId ? { appMapId: body.appMapId } : {}),
        ...(body.key ? { key: body.key } : {}),
      }),
    });
    return true;
  }

  if (method === "POST" && pathname === "/sign-ins") {
    const { actorId } = requireHumanSavedSignInReview();
    const body = savedSignInOperationInputSchemas["sign-in.save"].parse(
      (await parseJsonBody(request, 64 * 1024)) as object,
    );
    try {
      const signIn = await saveSavedSignIn({
        projectId: scope.projectId,
        appMapId: body.appMapId,
        ...(body.key ? { key: body.key } : {}),
        name: body.name,
        username: body.username,
        password: body.password,
        ...(body.usernameHint ? { usernameHint: body.usernameHint } : {}),
        ...(body.inboxKey ? { inboxKey: body.inboxKey } : {}),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
        createdBy: actorId,
      });
      json(response, 201, { signIn });
    } catch (error) {
      savedSignInConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/sign-ins/rotate") {
    const { actorId } = requireHumanSavedSignInReview();
    const body = savedSignInOperationInputSchemas["sign-in.rotate"].parse(
      (await parseJsonBody(request, 64 * 1024)) as object,
    );
    try {
      const signIn = await rotateSavedSignIn({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
        username: body.username,
        password: body.password,
        ...(body.usernameHint ? { usernameHint: body.usernameHint } : {}),
        ...(body.inboxKey ? { inboxKey: body.inboxKey } : {}),
        ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
        updatedBy: actorId,
      });
      json(response, 200, { signIn });
    } catch (error) {
      savedSignInConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/sign-ins/revoke") {
    const { actorId } = requireHumanSavedSignInReview();
    const body = savedSignInOperationInputSchemas["sign-in.revoke"].parse(
      (await parseJsonBody(request)) as object,
    );
    try {
      const signIns = await revokeSavedSignIn({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
        revokedBy: actorId,
      });
      json(response, 200, { key: body.key ?? "default", signIns });
    } catch (error) {
      savedSignInConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/sign-ins/resolve-check") {
    const body = savedSignInOperationInputSchemas["sign-in.resolve-check"].parse(
      (await parseJsonBody(request)) as object,
    );
    json(response, 200, {
      resolution: await checkSavedSignInResolution({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
      }),
    });
    return true;
  }

  return false;
}
