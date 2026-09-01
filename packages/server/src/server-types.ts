import type http from "node:http";
import type { AuthoringRuntime, captureScreenshot, TargetDriverRegistry } from "@relay/core";
import type { ExternalIdentityVerifier } from "./external-identity.js";
import type { AppMapTestRunRouteRuntime } from "./app-map-run-routes.js";
import type { CampaignDurationRouteRuntime } from "./campaign-duration-routes.js";
import type { JobRouteRuntime } from "./job-routes.js";
import type { RunRouteRuntime } from "./run-routes.js";
import type { StepRunRouteRuntime } from "./step-run-route.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";
import type { WorkflowRouteRuntime } from "./workflow-routes.js";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import type { GitHubProofWebhookConfiguration } from "./github-proof-intake.js";

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
  /** Explicit process-local drivers for provider-session targets. The default
   * registry remains local-only, so remote sessions are opt-in by host. */
  targetDriverRegistry?: TargetDriverRegistry;
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
  /** Test seam for durable workflow reconciliation and exact-once cancellation. */
  workflowRouteRuntime?: Partial<WorkflowRouteRuntime>;
  /** Test seam for repair-retry intent ordering. */
  runRouteRuntime?: Partial<RunRouteRuntime>;
  /** Test seam for server-owned Proof Run projection and lifecycle transitions. */
  proofRouteRuntime?: Partial<ChangeVerificationRouteRuntime>;
  /** Explicit signed GitHub pull-request intake boundary. Environment-backed
   * configuration is used when this host seam is omitted. */
  githubProofWebhook?: GitHubProofWebhookConfiguration;
  /** Test seam for standalone-step execution without a physical target. */
  stepRunRuntime?: Partial<StepRunRouteRuntime>;
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};
