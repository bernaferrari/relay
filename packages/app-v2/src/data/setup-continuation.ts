export type SetupContinuation = {
  kind: "record-test";
  returnTo: "/tests/new";
  appId?: string;
  targetId?: string;
};

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

export function readSetupContinuation(value: unknown): SetupContinuation | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (parsed.kind !== "record-test" || parsed.returnTo !== "/tests/new") return undefined;
    return {
      kind: "record-test",
      returnTo: "/tests/new",
      ...(typeof parsed.appId === "string" && parsed.appId ? { appId: parsed.appId } : {}),
      ...(typeof parsed.targetId === "string" && parsed.targetId
        ? { targetId: parsed.targetId }
        : {}),
    };
  } catch {
    return undefined;
  }
}
