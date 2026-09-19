export type SetupContinuation =
  | {
      kind: "record-test";
      returnTo: "/tests/new";
      appId?: string;
      targetId?: string;
    }
  | {
      kind: "run-setup";
      returnTo: "/tests";
      testId: string;
    };

/** Context repair for a new recording: sign in on a saved browser, then land
 * back on the recording setup with the same app and target preselected. */
export function newTestSetupContinuation(appId?: string, targetId?: string): string {
  return encodeURIComponent(
    JSON.stringify({
      kind: "record-test",
      returnTo: "/tests/new",
      ...(appId ? { appId } : {}),
      ...(targetId ? { targetId } : {}),
    } satisfies SetupContinuation),
  );
}

/** Context repair for a pending Run: refresh an account sign-in, then land
 * back on the same Test with its run setup reopened — the pending Test and
 * its resolved configuration are never lost to a detour (product direction:
 * repair prerequisites in context). */
export function runSetupContinuation(testId: string): string {
  return encodeURIComponent(
    JSON.stringify({
      kind: "run-setup",
      returnTo: "/tests",
      testId,
    } satisfies SetupContinuation),
  );
}

export function readSetupContinuation(value: unknown): SetupContinuation | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (parsed.kind === "record-test" && parsed.returnTo === "/tests/new") {
      return {
        kind: "record-test",
        returnTo: "/tests/new",
        ...(typeof parsed.appId === "string" && parsed.appId ? { appId: parsed.appId } : {}),
        ...(typeof parsed.targetId === "string" && parsed.targetId
          ? { targetId: parsed.targetId }
          : {}),
      };
    }
    if (
      parsed.kind === "run-setup" &&
      parsed.returnTo === "/tests" &&
      typeof parsed.testId === "string" &&
      parsed.testId.trim()
    ) {
      return { kind: "run-setup", returnTo: "/tests", testId: parsed.testId.trim() };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
