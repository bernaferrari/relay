import type { AppMapCombinePreflightIssue, CombineProfileTargetInput } from "@relay/protocol";
import {
  browserAuthenticationFixtureIsLive,
  collectBrowserTargetAccountHealth,
} from "./browser-account-health-summary.js";
import { listDevices } from "./workspace-devices.js";

function issue(
  code: AppMapCombinePreflightIssue["code"],
  message: string,
): AppMapCombinePreflightIssue {
  return { code, message };
}

function requestedFixtureAccountIds(
  profileTargets: readonly CombineProfileTargetInput[],
): string[] {
  const ids = new Set<string>();
  for (const target of profileTargets) {
    if (target.account?.kind !== "fixture") continue;
    const id = target.account.accountId.trim() || target.account.reference?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

function deviceColumn(
  target: CombineProfileTargetInput,
): { platform: "android" | "ios"; serial?: string } | undefined {
  const platform = target.target.platform;
  if (platform !== "android" && platform !== "ios") return undefined;
  const serial = target.target.serial?.trim();
  return { platform, ...(serial ? { serial } : {}) };
}

/**
 * Fail closed when a Plan asks for N account or device columns that are not
 * live. Never rewrite the requested column count down to the live inventory.
 */
export function preflightRequestedPlanColumns(input: {
  profileTargets: readonly CombineProfileTargetInput[];
  liveFixtureCount: number;
  connectedSerials: readonly string[];
}): AppMapCombinePreflightIssue[] {
  const blockers: AppMapCombinePreflightIssue[] = [];
  const fixtureIds = requestedFixtureAccountIds(input.profileTargets);
  const requested = fixtureIds.length;
  if (requested > 0 && requested > input.liveFixtureCount) {
    blockers.push(
      issue(
        "missing-binding",
        `This Plan asked for ${requested} live sign-ins. This Mac has ${input.liveFixtureCount}. Missing accounts are Infra, not a ${input.liveFixtureCount}-column pass.`,
      ),
    );
  }
  const connected = new Set(input.connectedSerials.map((serial) => serial.trim()).filter(Boolean));
  for (const target of input.profileTargets) {
    const column = deviceColumn(target);
    if (!column) continue;
    const label = column.platform === "android" ? "Android" : "iOS";
    if (!column.serial || !connected.has(column.serial)) {
      blockers.push(
        issue(
          "target-missing",
          `${label} column needs a connected device. None attached. Missing devices are Infra, not a browser-only Plan.`,
        ),
      );
    }
  }
  return blockers;
}

/** Remembered live sign-ins. Unsigned / auth Lanes are not SuperGrok members. */
export async function collectLiveFixtureReferences(input: {
  projectId: string;
  profileTargets: readonly CombineProfileTargetInput[];
}): Promise<string[]> {
  const browserTargetIds = [
    ...new Set(
      input.profileTargets
        .map((target) => target.target.browserTargetId?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const refs = new Set<string>();
  for (const targetId of browserTargetIds) {
    try {
      const collected = await collectBrowserTargetAccountHealth({
        projectId: input.projectId,
        targetId,
      });
      for (const fixture of collected.fixtures) {
        if (browserAuthenticationFixtureIsLive(fixture) && fixture.reference.trim()) {
          refs.add(fixture.reference.trim());
        }
      }
    } catch {
      // Remembered health unavailable is zero live fixtures, never a silent N-account pass.
    }
  }
  return [...refs];
}

/** Workspace facts for column preflight. Does not probe fixtures or load launchd. */
export async function preflightRequestedPlanColumnsAgainstWorkspace(input: {
  projectId: string;
  profileTargets: readonly CombineProfileTargetInput[];
}): Promise<AppMapCombinePreflightIssue[]> {
  if (!input.profileTargets.length) return [];
  const liveFixtureReferences = await collectLiveFixtureReferences(input);
  const liveFixtureCount = liveFixtureReferences.length;
  const needsDevices = input.profileTargets.some((target) => deviceColumn(target));
  const connectedSerials = needsDevices
    ? (await listDevices().catch(() => [])).map((device) => device.serial)
    : [];
  return preflightRequestedPlanColumns({
    profileTargets: input.profileTargets,
    liveFixtureCount,
    connectedSerials,
  });
}
