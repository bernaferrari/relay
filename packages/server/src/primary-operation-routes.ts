import type http from "node:http";
import type { AuthoringRuntime } from "@relay/core";
import type { AppMapTestRunRouteRuntime } from "./app-map-test-run-runtime.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";
import { handleAppMapRoute } from "./app-map-routes.js";
import type { CampaignDurationRouteRuntime } from "./campaign-duration-routes.js";
import type { JobRouteRuntime } from "./job-routes.js";
import type { RequestContext } from "./security.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";
import { handleTargetRuntimeRoute } from "./target-runtime-routes.js";
import type { WorkflowRouteRuntime } from "./workflow-routes.js";
import { handleWorkflowRoute } from "./workflow-routes.js";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import { handleChangeVerificationRoute } from "./change-verification-routes.js";

export type PrimaryOperationRouteRuntimes = {
  authoring?: AuthoringRuntime;
  appMapTestRun?: Partial<AppMapTestRunRouteRuntime>;
  jobs?: Partial<JobRouteRuntime>;
  workflow?: Partial<WorkflowRouteRuntime>;
  proof?: Partial<ChangeVerificationRouteRuntime>;
  target?: Partial<TargetRuntimeRouteRuntime>;
  campaignDuration?: CampaignDurationRouteRuntime;
};

/** Preserve the canonical early-route order behind one bounded dispatcher. */
export async function handlePrimaryOperationRoutes(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtimes: PrimaryOperationRouteRuntimes;
}): Promise<boolean> {
  const shared = {
    method: input.method,
    pathname: input.pathname,
    request: input.request,
    response: input.response,
    scope: input.scope,
  };
  return (
    (await handleAppMapRunRoute({
      ...shared,
      runtime: input.runtimes.appMapTestRun,
      combineRuntime: input.runtimes.jobs,
    })) ||
    (await handleAppMapRoute({ ...shared, authoringRuntime: input.runtimes.authoring })) ||
    (await handleChangeVerificationRoute({ ...shared, runtime: input.runtimes.proof })) ||
    (await handleWorkflowRoute({ ...shared, runtime: input.runtimes.workflow })) ||
    (await handleTargetRuntimeRoute({
      ...shared,
      runtime: input.runtimes.target,
      campaignDurationRuntime: input.runtimes.campaignDuration,
    }))
  );
}
