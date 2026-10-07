import type http from "node:http";
import {
  createAppMapTestExecutionIntent,
  enqueueJob,
  listDevices,
  observeIosNativeViewport,
  prepareRegisteredBuildForProof,
  readBuild,
  readProjectVariables,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import type { AppMapProofExecutionAuthority } from "./app-map-proof-execution-admission.js";
import type { JobRouteRuntime } from "./job-routes.js";
import type { RequestContext } from "./security.js";

/** Host seam for proving a blocked Test run stays entirely offline. */
export type AppMapTestRunRouteRuntime = {
  listDevices: typeof listDevices;
  observeIosNativeViewport: typeof observeIosNativeViewport;
  assertTargetControl: typeof assertTargetControl;
  createAppMapTestExecutionIntent: typeof createAppMapTestExecutionIntent;
  enqueueJob: typeof enqueueJob;
  readBuild: typeof readBuild;
  readProjectVariables: typeof readProjectVariables;
  prepareBuildForProof: typeof prepareRegisteredBuildForProof;
};

export const defaultTestRunRuntime: AppMapTestRunRouteRuntime = {
  listDevices,
  observeIosNativeViewport,
  assertTargetControl,
  createAppMapTestExecutionIntent,
  enqueueJob,
  readBuild,
  readProjectVariables,
  prepareBuildForProof: prepareRegisteredBuildForProof,
};

export type AppMapRunRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  /** Proof-only admission membrane. Canonical Test preflight must match the
   * risk authority frozen by the calling Verification Cell before lease or enqueue. */
  proofExecutionAuthority?: AppMapProofExecutionAuthority & {
    buildId?: string;
    sourceSha?: string;
    artifactDigest?: string;
  };
  runtime?: Partial<AppMapTestRunRouteRuntime>;
  combineRuntime?: Partial<JobRouteRuntime>;
};
