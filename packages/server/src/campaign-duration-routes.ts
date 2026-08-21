import type http from "node:http";
import type { CampaignCapacityCohortDurationEstimateRequest } from "@relay/protocol";
import {
  estimateCampaignDurationCohorts,
  type CampaignDurationCohortEvidenceRuntime,
} from "./campaign-duration-cohort-evidence.js";
import { json, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export type CampaignDurationRouteRuntime = Partial<CampaignDurationCohortEvidenceRuntime>;

/** Read-only duration evidence transport. Kept apart from mutable campaign
 * routes so it stays safe to refresh from a UI, CLI, or future device farm
 * planner before any lease/admission side effect. */
export async function handleCampaignDurationRoute(context: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: CampaignDurationRouteRuntime;
}): Promise<boolean> {
  if (context.method !== "POST" || context.pathname !== "/campaign-duration/cohorts/estimate") {
    return false;
  }
  const request = (await parseJsonBody(
    context.request,
  )) as CampaignCapacityCohortDurationEstimateRequest;
  const estimate = await estimateCampaignDurationCohorts({
    scope: context.scope,
    request,
    runtime: context.runtime,
  });
  json(context.response, 200, estimate);
  return true;
}
