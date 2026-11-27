import {
  checkTestInboxResolution,
  currentOperationContext,
  listTestInboxes,
  revokeTestInbox,
  rotateTestInbox,
  saveTestInbox,
  TestInboxStoreError,
} from "@relay/core";
import { testInboxOperationInputSchemas } from "@relay/protocol";
import { HttpError, json, parseJsonBody } from "../http.js";
import type { ServerRouteInput } from "../server-route-input.js";

function requireHumanInboxReview(): { actorId: string } {
  const operation = currentOperationContext();
  if (!operation || operation.actorKind !== "human") {
    throw new HttpError(403, "Test inbox changes require a human reviewer", {
      code: "HUMAN_REVIEW_REQUIRED",
      recovery: "Ask a person to save, rotate, or revoke the test inbox.",
    });
  }
  return { actorId: operation.actorId };
}

function inboxConflict(error: unknown): never {
  if (error instanceof TestInboxStoreError) {
    throw new HttpError(409, error.message, {
      code: `TEST_INBOX_${error.code.replaceAll("-", "_").toUpperCase()}`,
      recovery:
        error.code === "exists"
          ? "Use relay inbox rotate for the existing test inbox, or choose a different key."
          : "Review the test inbox metadata and try again as a person.",
    });
  }
  throw error;
}

/** Project-scoped test inboxes. Mutation is human-only; responses contain
 * metadata only and no ciphertext, credentials, message content, or export route exists. */
export async function handleTestInboxRoute(input: ServerRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;
  if (pathname !== "/inboxes" && !pathname.startsWith("/inboxes/")) return false;

  if (method === "GET" && pathname === "/inboxes") {
    const body = testInboxOperationInputSchemas["inbox.list"].parse({
      ...(url.searchParams.get("key") ? { key: url.searchParams.get("key") } : {}),
    });
    json(response, 200, {
      inboxes: await listTestInboxes({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
      }),
    });
    return true;
  }

  if (method === "POST" && pathname === "/inboxes") {
    const { actorId } = requireHumanInboxReview();
    const body = testInboxOperationInputSchemas["inbox.save"].parse(
      (await parseJsonBody(request, 64 * 1024)) as object,
    );
    try {
      const inbox = await saveTestInbox({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
        name: body.name,
        host: body.host,
        port: body.port,
        secure: body.secure,
        mailbox: body.mailbox,
        ...(body.recipient ? { recipient: body.recipient } : {}),
        ...(body.usernameHint ? { usernameHint: body.usernameHint } : {}),
        username: body.username,
        password: body.password,
        createdBy: actorId,
      });
      json(response, 201, { inbox });
    } catch (error) {
      inboxConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/inboxes/rotate") {
    const { actorId } = requireHumanInboxReview();
    const body = testInboxOperationInputSchemas["inbox.rotate"].parse(
      (await parseJsonBody(request, 64 * 1024)) as object,
    );
    try {
      const inbox = await rotateTestInbox({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
        ...(body.host ? { host: body.host } : {}),
        ...(body.port ? { port: body.port } : {}),
        ...(body.secure === undefined ? {} : { secure: body.secure }),
        ...(body.mailbox ? { mailbox: body.mailbox } : {}),
        ...(body.recipient ? { recipient: body.recipient } : {}),
        ...(body.usernameHint ? { usernameHint: body.usernameHint } : {}),
        username: body.username,
        password: body.password,
        updatedBy: actorId,
      });
      json(response, 200, { inbox });
    } catch (error) {
      inboxConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/inboxes/revoke") {
    const { actorId } = requireHumanInboxReview();
    const body = testInboxOperationInputSchemas["inbox.revoke"].parse(
      (await parseJsonBody(request)) as object,
    );
    try {
      const inboxes = await revokeTestInbox({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
        revokedBy: actorId,
      });
      json(response, 200, { key: body.key ?? "default", inboxes });
    } catch (error) {
      inboxConflict(error);
    }
    return true;
  }

  if (method === "POST" && pathname === "/inboxes/check") {
    const body = testInboxOperationInputSchemas["inbox.check"].parse(
      (await parseJsonBody(request)) as object,
    );
    json(response, 200, {
      resolution: await checkTestInboxResolution({
        projectId: scope.projectId,
        ...(body.key ? { key: body.key } : {}),
      }),
    });
    return true;
  }

  return false;
}
