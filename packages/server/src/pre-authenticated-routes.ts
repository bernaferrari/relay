import type http from "node:http";
import { json } from "./http.js";
import {
  GitHubProofIntakeError,
  processGitHubPullRequestWebhook,
  readGitHubWebhookBody,
  type GitHubProofWebhookConfiguration,
} from "./github-proof-intake.js";
import { handlePublicRunShareRoute } from "./run-share-routes.js";

type PreAuthenticatedRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
};

export function createPreAuthenticatedRoute(github?: GitHubProofWebhookConfiguration) {
  return async (input: PreAuthenticatedRouteInput): Promise<boolean> => {
    if (
      await handlePublicRunShareRoute({
        method: input.method,
        pathname: input.pathname,
        response: input.response,
      })
    ) {
      return true;
    }
    if (input.pathname !== "/webhooks/github") return false;
    if (input.method !== "POST" || !github) {
      json(input.response, 404, { error: "GitHub Proof webhook is not configured" });
      return true;
    }
    try {
      const result = await processGitHubPullRequestWebhook({
        body: await readGitHubWebhookBody(input.request),
        headers: input.request.headers,
        secret: github.secret,
        configuredRepository: github.repository,
        scope: github.scope,
        runtime: github.runtime,
      });
      json(input.response, result.disposition === "replayed" ? 200 : 202, result);
    } catch (error) {
      if (!(error instanceof GitHubProofIntakeError)) throw error;
      const status =
        error.code === "WEBHOOK_SIGNATURE_INVALID"
          ? 401
          : error.code === "WEBHOOK_HEADERS_INVALID" || error.code === "WEBHOOK_PAYLOAD_INVALID"
            ? 400
            : 409;
      json(input.response, status, { error: error.message, code: error.code });
    }
    return true;
  };
}
