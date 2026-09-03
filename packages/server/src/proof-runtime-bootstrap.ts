import {
  now,
  vercelWebDeploymentProviderFromEnvironment,
  type AuthoritativeWebDeploymentLookup,
} from "@relay/core";
import { executeRecoveredChangeProofCell } from "./change-proof-cell-executor.js";
import { proofExecutionCoordinator } from "./change-proof-execution-runtime.js";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import { createProofPublicationWorker } from "./proof-publication-runtime.js";

/** Assemble one Proof runtime so routes, recovery, and publication share the
 * same provider authority instead of resolving process configuration twice. */
export function createProofRuntimeBootstrap(
  configured: Partial<ChangeVerificationRouteRuntime> | undefined,
  explicitWebDeploymentLookup: AuthoritativeWebDeploymentLookup | undefined,
) {
  const webDeploymentLookup =
    explicitWebDeploymentLookup ?? vercelWebDeploymentProviderFromEnvironment();
  const proofRouteRuntime: Partial<ChangeVerificationRouteRuntime> = {
    ...configured,
    ...(webDeploymentLookup ? { lookupWebDeployment: webDeploymentLookup } : {}),
  };
  return {
    proofRouteRuntime,
    proofPublicationWorker: createProofPublicationWorker(proofRouteRuntime),
    proofCoordinator: proofExecutionCoordinator(proofRouteRuntime),
    recoverProofCell:
      configured?.executeCell ??
      ((input: Parameters<typeof executeRecoveredChangeProofCell>[0]) =>
        executeRecoveredChangeProofCell(input, now())),
  };
}
