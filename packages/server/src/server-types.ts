import type http from "node:http";
import type { AuthoringRuntime, captureScreenshot } from "@relay/core";
import type { ExternalIdentityVerifier } from "./external-identity.js";
import type { AppMapTestRunRouteRuntime } from "./app-map-run-routes.js";
import type { CampaignDurationRouteRuntime } from "./campaign-duration-routes.js";
import type { JobRouteRuntime } from "./job-routes.js";
import type { RunRouteRuntime } from "./run-routes.js";
import type { StepRunRouteRuntime } from "./step-run-route.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";

/** Host-owned server seams, kept separate from the HTTP router implementation. */
export type StartServerOptions = {
  port?: number;
  host?: string;
  token?: string;
  /** Exact HTTP(S) renderer origins that may use local browser trust. */
  browserOrigins?: readonly string[];
  /** Trusted bridge for externally verified bearer credentials. */
  externalIdentityVerifier?: ExternalIdentityVerifier;
  authoringRuntime?: AuthoringRuntime;
  /** Test seam for the host-owned Android stream transport. */
  liveVideoStream?: (response: http.ServerResponse, serial: string) => Promise<void>;
  /** Test seam for target observation without starting a device daemon. */
  captureTargetScreenshot?: typeof captureScreenshot;
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>;
  /** Test seam for read-only persisted-run cohort duration estimation. */
  campaignDurationRuntime?: CampaignDurationRouteRuntime;
  /** Test seam for proving blocked Test runs do not touch a target or queue work. */
  appMapTestRunRuntime?: Partial<AppMapTestRunRouteRuntime>;
  /** Test seam for retry/replay/resume intent ordering. */
  jobRouteRuntime?: Partial<JobRouteRuntime>;
  /** Test seam for repair-retry intent ordering. */
  runRouteRuntime?: Partial<RunRouteRuntime>;
  /** Test seam for standalone-step execution without a physical target. */
  stepRunRuntime?: Partial<StepRunRouteRuntime>;
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};
