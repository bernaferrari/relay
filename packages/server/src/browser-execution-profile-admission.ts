import {
  browserCaseProfileForTarget,
  readTarget,
  sameAppMapRuntimeTargetProfile,
} from "@relay/core";
import type { BrowserCaseProfile, ExecutionTargetRef, TargetProfile } from "@relay/protocol";
import { HttpError } from "./http.js";

type FrozenBrowserExecution = {
  executionTarget?: ExecutionTargetRef;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  serial?: string;
  platform?: string;
  browserCaseProfile?: BrowserCaseProfile;
  targetProfile?: TargetProfile;
};

export type BrowserExecutionProfileAdmissionRuntime = {
  readTarget: typeof readTarget;
};

function localBrowserTargetId(execution: FrozenBrowserExecution): string | undefined {
  if (execution.executionTarget) {
    return execution.executionTarget.kind === "local-browser"
      ? execution.executionTarget.identity.value
      : undefined;
  }
  if (
    execution.targetKind !== "browser" &&
    execution.platform !== "browser" &&
    !execution.browserTargetId
  ) {
    return undefined;
  }
  return (execution.browserTargetId ?? execution.serial)?.trim() || undefined;
}

function sameBrowserProfile(input: {
  id: string;
  targetId: string;
  left: BrowserCaseProfile;
  right: BrowserCaseProfile;
}): boolean {
  return sameAppMapRuntimeTargetProfile(
    {
      id: input.id,
      targetId: input.targetId,
      platform: "browser",
      viewport: input.left.viewport,
      browserCaseProfile: input.left,
    },
    {
      id: input.id,
      targetId: input.targetId,
      platform: "browser",
      viewport: input.right.viewport,
      browserCaseProfile: input.right,
    },
  );
}

/** Re-observe the mutable managed browser environment before any retry,
 * replay, resume, or selective repair can regain target control. The frozen
 * Run remains authoritative; drift is review-required rather than silently
 * launching under a different locale, network, auth, or engine contract. */
export async function assertCurrentBrowserExecutionProfile(input: {
  execution: FrozenBrowserExecution;
  runtime?: Partial<BrowserExecutionProfileAdmissionRuntime>;
}): Promise<void> {
  const targetId = localBrowserTargetId(input.execution);
  if (!targetId) return;
  const profile = input.execution.targetProfile;
  const frozen = input.execution.browserCaseProfile ?? profile?.browserCaseProfile;
  if (!frozen) {
    throw new HttpError(409, "The browser execution has no frozen environment profile", {
      code: "FROZEN_BROWSER_PROFILE_REQUIRED",
      targetId,
      recovery: "Create a new reviewed browser Proof before controlling this target.",
    });
  }
  if (
    profile &&
    (profile.targetId !== targetId ||
      profile.platform !== "browser" ||
      (profile.browserCaseProfile &&
        !sameBrowserProfile({
          id: profile.id,
          targetId,
          left: frozen,
          right: profile.browserCaseProfile,
        })))
  ) {
    throw new HttpError(409, "The frozen browser execution profiles disagree", {
      code: "TARGET_PROFILE_TARGET_MISMATCH",
      targetId,
      recovery: "Inspect the immutable Run and create a new reviewed Proof.",
    });
  }
  const target = await (input.runtime?.readTarget ?? readTarget)(targetId);
  if (!target || target.kind !== "browser") {
    throw new HttpError(409, `Managed browser target ${targetId} is unavailable`, {
      code: "TARGET_PROFILE_TARGET_MISMATCH",
      targetId,
      recovery: "Restore the frozen managed browser target before retrying this execution.",
    });
  }
  const observed = browserCaseProfileForTarget(target);
  if (
    !sameBrowserProfile({
      id: profile?.id ?? `browser:${targetId}`,
      targetId,
      left: frozen,
      right: observed,
    })
  ) {
    throw new HttpError(409, `Managed browser target ${targetId} has drifted since this Run`, {
      code: "TARGET_PROFILE_TARGET_MISMATCH",
      targetId,
      recovery:
        "Restore the complete frozen browser environment, or create and review a new Proof for the current environment.",
    });
  }
}
