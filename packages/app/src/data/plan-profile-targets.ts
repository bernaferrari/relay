import type { BrowserEngine } from "@relay/protocol";
import type { ProductRunAccountBinding } from "@relay/product/run-journey";
import type { ProductEnvironmentProfile } from "./suite-profile-product-service";

export const MAX_PLAN_PROFILE_TARGETS = 64;

export type PlanStartAccountBinding = {
  readonly profileId: string;
  readonly engine?: BrowserEngine;
  readonly account: ProductRunAccountBinding;
};

export type PlanStartProfileTarget = {
  readonly profileId: string;
  readonly engine?: BrowserEngine;
  readonly account?: ProductRunAccountBinding;
  readonly target: {
    readonly targetKind: "device" | "browser";
    readonly serial?: string;
    readonly platform?: "android" | "ios" | "browser";
    readonly browserTargetId?: string;
  };
};

function planTargetFromProfile(
  profile: ProductEnvironmentProfile,
): PlanStartProfileTarget["target"] {
  if (profile.platform === "browser") {
    return { targetKind: "browser", browserTargetId: profile.targetId };
  }
  return { targetKind: "device", serial: profile.targetId, platform: profile.platform };
}

/** One Combine profileTarget per account column, then remaining devices. */
export function compilePlanProfileTargets(
  profiles: readonly ProductEnvironmentProfile[],
  accounts: readonly PlanStartAccountBinding[] = [],
): PlanStartProfileTarget[] {
  const byId = new Map(profiles.map((item) => [item.id, item]));
  const claimed = new Set<string>();
  const targets: PlanStartProfileTarget[] = [];
  for (const binding of accounts) {
    const profile = byId.get(binding.profileId);
    if (!profile) throw new TypeError("That browser or device is not available.");
    const engine = binding.engine ?? (profile.platform === "browser" ? "chromium" : undefined);
    if (!engine) throw new TypeError("Each account needs a browser engine.");
    claimed.add(profile.id);
    targets.push({
      profileId: profile.id,
      engine,
      account: binding.account,
      target: planTargetFromProfile(profile),
    });
  }
  for (const profile of profiles) {
    if (claimed.has(profile.id)) continue;
    targets.push({
      profileId: profile.id,
      target: planTargetFromProfile(profile),
    });
  }
  if (!targets.length) throw new TypeError("Choose at least one browser or device.");
  if (targets.length > MAX_PLAN_PROFILE_TARGETS) {
    throw new TypeError(`Select no more than ${MAX_PLAN_PROFILE_TARGETS} browsers or devices.`);
  }
  return targets;
}
