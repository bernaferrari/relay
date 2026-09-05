import type { AuthoringTarget, DeviceSummary } from "@relay/protocol";

export type ProductTargetOption = AuthoringTarget & {
  /** Human-facing identity from Relay's validated target catalog. */
  name: string;
  detail: string;
};

type TargetCatalogClient = {
  invoke(
    id: "target.devices.list",
    input: Record<string, never>,
  ): Promise<{ devices: DeviceSummary[] }>;
};

/**
 * Adds presentation metadata to Product's canonical ready-target set. The
 * catalog may name a target, but it never decides whether that target is ready.
 */
export async function presentReadyTargets(
  client: TargetCatalogClient,
  targets: readonly AuthoringTarget[],
): Promise<readonly ProductTargetOption[]> {
  const devices = await client
    .invoke("target.devices.list", {})
    .then((result) => result.devices)
    .catch(() => [] as DeviceSummary[]);
  const drafts = targets.map((target) => {
    const device = devices.find(
      (candidate) => candidate.serial === target.targetId || candidate.id === target.targetId,
    );
    const fallback = fallbackName(target);
    const catalogName = cleanName(device?.name, target.targetId);
    return {
      ...target,
      name: catalogName ?? fallback,
      detail: targetDetail(target, device),
    };
  });

  const totals = new Map<string, number>();
  for (const item of drafts) {
    const key = item.name.toLocaleLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return drafts.map((item) => {
    const key = item.name.toLocaleLowerCase();
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    return {
      ...item,
      name: (totals.get(key) ?? 0) > 1 ? `${item.name} ${ordinal}` : item.name,
    };
  });
}

export function fallbackTargetOption(target: AuthoringTarget): ProductTargetOption {
  return { ...target, name: fallbackName(target), detail: targetDetail(target) };
}

function cleanName(value: string | undefined, targetId: string): string | undefined {
  const name = value?.trim().replace(/\s+/gu, " ").slice(0, 120);
  if (!name || name === targetId || looksLikeMachineIdentifier(name)) return undefined;
  return name;
}

function looksLikeMachineIdentifier(value: string): boolean {
  return (
    /^emulator-\d+$/iu.test(value) ||
    /^[0-9a-f]{24,}$/iu.test(value) ||
    /^browser[-_:][a-z0-9._:-]+$/iu.test(value)
  );
}

function fallbackName(target: AuthoringTarget): string {
  if (target.kind === "browser") return "Managed browser";
  if (target.platform === "ios") return "iOS device";
  return /^emulator(?:-|$)/iu.test(target.targetId) ? "Android emulator" : "Android device";
}

function targetDetail(target: AuthoringTarget, device?: DeviceSummary): string {
  if (target.kind === "browser") return "Managed browser";
  const kind =
    target.platform === "ios"
      ? "iOS"
      : /^emulator(?:-|$)/iu.test(target.targetId) || /emulator/iu.test(device?.kind ?? "")
        ? "Android emulator"
        : "Android";
  const version = device?.osVersion?.trim();
  return [kind, version, "Ready"].filter(Boolean).join(" · ");
}
