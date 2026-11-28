import type { BrowserAccountOverlap } from "@relay/core";
import type { RoutineSharingPolicy } from "@relay/protocol";
import type { RunSavedSignInAdmission } from "../sign-in/sign-in-run-admission.js";

/** Browser overlap facts admitted for one frozen Test run. Runtime sign-ins
 * never join the unsigned reader group: they either prove a complete set of
 * local logical account keys or conservatively keep exclusive serialization. */
export function browserTestRunOverlapAdmission(input: {
  targetKind: "device" | "browser";
  laneId?: string;
  authenticationFixtureId?: string;
  signIns: readonly RunSavedSignInAdmission[];
  sharing: RoutineSharingPolicy;
}): {
  browserIsolation?: "independent";
  browserAccountOverlap?: BrowserAccountOverlap;
} {
  if (
    input.targetKind !== "browser" ||
    input.laneId?.trim() ||
    input.authenticationFixtureId?.trim()
  ) {
    return {};
  }
  if (!input.signIns.length) {
    return input.sharing === "safe-shared-read" ? { browserIsolation: "independent" } : {};
  }
  const separableLocalAccounts = input.signIns.every(
    (signIn) => signIn.source === "local" && Boolean(signIn.reference?.trim()),
  );
  if (
    !separableLocalAccounts ||
    (input.sharing !== "safe-shared-read" &&
      input.sharing !== "isolated-account" &&
      input.sharing !== "isolated-lane")
  ) {
    return {};
  }
  return {
    browserAccountOverlap: {
      accountKeys: input.signIns.map((signIn) => signIn.key),
      sharing: input.sharing,
    },
  };
}
