import {
  AccountNeedsReloginError,
  accountReloginFindingsReport,
  browserCaseProfileForTarget,
  claimedBrowserJobStartBlocker,
  readTarget,
  type TestJob,
} from "@relay/core";
import type { ExecutionTargetRef } from "@relay/protocol";
import { HttpError } from "./http.js";

export function accountNeedsReloginHttpError(detail: string): HttpError {
  return new HttpError(409, detail, {
    code: "ACCOUNT_NEEDS_RELOGIN",
    recovery: "Open Sign-ins, complete OAuth, then Refresh.",
    findings: accountReloginFindingsReport({ detail }),
  });
}

export function httpErrorFromAccountNeedsRelogin(error: unknown): HttpError | undefined {
  return error instanceof AccountNeedsReloginError
    ? accountNeedsReloginHttpError(error.detail)
    : undefined;
}

export async function rejectBlockedClaimedBrowserJob(input: {
  projectId: string;
  targetId?: string;
  browserCaseProfile?: TestJob["browserCaseProfile"];
  targetProfile?: TestJob["targetProfile"];
  parentAuthenticationHealth?: TestJob["authenticationHealth"];
}): Promise<TestJob["authenticationHealth"]> {
  const result = await claimedBrowserJobStartBlocker(input);
  if (result.blocker) throw accountNeedsReloginHttpError(result.blocker);
  return result.authenticationHealth;
}

export async function browserCaseProfileForAdmission(targetId: string | undefined) {
  const id = targetId?.trim();
  if (!id) return undefined;
  const target = await readTarget(id);
  if (!target || target.kind !== "browser") {
    throw new HttpError(404, `Managed browser target not found: ${id}`);
  }
  return browserCaseProfileForTarget(target);
}

/** Device serials stay device jobs. A managed browser id still fail-closes. */
export async function browserCaseProfileIfManaged(targetId: string | undefined) {
  const id = targetId?.trim();
  if (!id) return undefined;
  const target = await readTarget(id);
  if (!target || target.kind !== "browser") return undefined;
  return browserCaseProfileForTarget(target);
}

export function browserJobTargetId(job: {
  browserTargetId?: string;
  targetKind?: string;
  serial?: string;
  platform?: string;
  targetContext?: { kind?: string; targetId?: string };
  executionTarget?: ExecutionTargetRef;
  targetProfile?: { targetId?: string };
}): string | undefined {
  if (job.executionTarget?.kind === "local-browser") return job.executionTarget.identity.value;
  if (job.targetContext?.kind === "browser") return job.targetContext.targetId;
  if (job.targetKind === "browser" || job.platform === "browser") {
    return job.browserTargetId ?? job.serial ?? job.targetProfile?.targetId;
  }
  return job.browserTargetId;
}
