/** Claimed SuperGrok admission for session enqueue and resume. */
import {
  assertClaimedBrowserJobStartAllowed,
  assertClaimedBrowserJobStartAllowedSync,
} from "./browser-auth-health.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";
import type { SessionBatchInput } from "./session-batch-admission.js";
import type { TestJob } from "./session-contract.js";

type ClaimedBrowserJobIdentity = {
  projectId?: string;
  browserTargetId?: string;
  serial?: string;
  targetKind?: string;
  platform?: string;
  targetContext?: { kind?: string; targetId?: string };
  executionTarget?: { kind?: string; identity?: { value: string } };
  browserCaseProfile?: TestJob["browserCaseProfile"];
  targetProfile?: TestJob["targetProfile"];
  authenticationHealth?: TestJob["authenticationHealth"];
};

function claimedBrowserTargetId(job: ClaimedBrowserJobIdentity): string | undefined {
  if (job.executionTarget?.kind === "local-browser") return job.executionTarget.identity?.value;
  if (job.targetContext?.kind === "browser") return job.targetContext.targetId;
  if (job.targetKind === "browser" || job.platform === "browser") {
    return job.browserTargetId ?? job.serial ?? job.targetProfile?.targetId;
  }
  return job.browserTargetId;
}

function claimedBrowserAdmissionInput(job: ClaimedBrowserJobIdentity) {
  return {
    projectId: job.projectId?.trim() || currentOperationContext()?.projectId || "default",
    targetId: claimedBrowserTargetId(job),
    browserCaseProfile: job.browserCaseProfile,
    targetProfile: job.targetProfile,
    parentAuthenticationHealth: job.authenticationHealth,
  };
}

export async function assertClaimedBrowserExecutionAllowed(
  job: ClaimedBrowserJobIdentity,
): Promise<TestJob["authenticationHealth"]> {
  return assertClaimedBrowserJobStartAllowed(claimedBrowserAdmissionInput(job));
}

export function assertClaimedBrowserExecutionAllowedSync(
  job: ClaimedBrowserJobIdentity,
): TestJob["authenticationHealth"] {
  return assertClaimedBrowserJobStartAllowedSync(claimedBrowserAdmissionInput(job));
}

/** Fail-closed claimed-fixture gate before any job object is created. */
export function admitClaimedBrowserJobBatch(
  inputs: readonly SessionBatchInput[],
): SessionBatchInput[] {
  return inputs.map(({ input, operationContext }) => {
    const admit = (): SessionBatchInput => {
      const authenticationHealth = assertClaimedBrowserExecutionAllowedSync(input);
      return {
        ...(operationContext ? { operationContext } : {}),
        input: authenticationHealth ? { ...input, authenticationHealth } : input,
      };
    };
    return operationContext ? runWithOperationContext(operationContext, admit) : admit();
  });
}
