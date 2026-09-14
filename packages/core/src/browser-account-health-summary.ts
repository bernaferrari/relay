import type {
  BrowserAuthenticationFixture,
  BrowserAuthenticationHealth,
  Lane,
  LaneSaveInput,
} from "@relay/protocol";
import { browserAccountSchedulingKey, unsignedBrowserLaneId } from "./browser-account-lane.js";
import {
  attachBrowserAuthenticationHealth,
  probeBrowserAuthenticationFixture,
  type BrowserAuthPageSnapshot,
} from "./browser-auth-health.js";
import { listBrowserAuthenticationFixtures } from "./browser-authentication-fixtures.js";
import { laneFixtureReference, listLanes } from "./lane.js";

export type BrowserAccountHealthLane = {
  id: string;
  schedulingKey: string;
  kind: "fixture" | "signed-out";
  live: boolean;
};

export type BrowserAccountHealthSummary = {
  liveCount: number;
  revokedCount: number;
  readyCount: number;
  needsReloginCount: number;
  expiredCount: number;
  errorCount: number;
  concurrentAccountsPossible: boolean;
  concurrentReason: string;
  lanes: BrowserAccountHealthLane[];
};

type FixtureHealthView = {
  reference: string;
  revokedAt?: number;
  health?: Pick<BrowserAuthenticationHealth, "status">;
};

/** A revoked fixture is not a live account, even if health is stale. */
export function browserAuthenticationFixtureIsLive(
  fixture: Pick<FixtureHealthView, "revokedAt" | "health">,
): boolean {
  if (fixture.revokedAt !== undefined) return false;
  return fixture.health?.status !== "revoked";
}

export function concurrentBrowserAccountCopy(liveCount: number): string {
  if (liveCount >= 3) {
    return `${liveCount} live accounts can run the same Test concurrently. Preflight still quotes observed serial until a measured N-account pack exists.`;
  }
  if (liveCount === 2) {
    return "Two live accounts can run concurrently. A 3-account Plan needs a third saved sign-in.";
  }
  if (liveCount === 1) {
    return "One live account. Concurrent N-account Plans need another saved sign-in. Signed-out remains a separate lane.";
  }
  return "No live accounts. Signed-out remains a separate lane. Save a sign-in before a fixture Lane.";
}

function statusOf(fixture: FixtureHealthView): BrowserAuthenticationHealth["status"] | "ready" {
  if (fixture.revokedAt !== undefined) return "revoked";
  return fixture.health?.status ?? "ready";
}

export function browserAccountLaneBindings(input: {
  targetId: string;
  fixtures: readonly FixtureHealthView[];
  lanes: readonly Pick<LaneSaveInput, "id" | "target" | "account">[];
}): BrowserAccountHealthLane[] {
  const targetId = input.targetId.trim();
  const liveReferences = new Set(
    input.fixtures.filter(browserAuthenticationFixtureIsLive).map((fixture) => fixture.reference),
  );
  const lanes: BrowserAccountHealthLane[] = [];
  for (const lane of input.lanes) {
    if (lane.target.kind !== "browser" || lane.target.browserTargetId !== targetId) continue;
    const fixtureReference = laneFixtureReference(lane);
    if (fixtureReference) {
      lanes.push({
        id: lane.id,
        schedulingKey: browserAccountSchedulingKey(targetId, fixtureReference),
        kind: "fixture",
        live: liveReferences.has(fixtureReference),
      });
      continue;
    }
    lanes.push({
      id: lane.id,
      schedulingKey: browserAccountSchedulingKey(
        targetId,
        undefined,
        unsignedBrowserLaneId({ laneId: lane.id }),
      ),
      kind: "signed-out",
      live: true,
    });
  }
  return lanes;
}

export function summarizeBrowserAccountHealth(input: {
  targetId: string;
  fixtures: readonly FixtureHealthView[];
  lanes?: readonly Pick<LaneSaveInput, "id" | "target" | "account">[];
}): BrowserAccountHealthSummary {
  const live = input.fixtures.filter(browserAuthenticationFixtureIsLive);
  const statuses = input.fixtures.map(statusOf);
  const liveCount = live.length;
  return {
    liveCount,
    revokedCount: statuses.filter((status) => status === "revoked").length,
    readyCount: live.filter((fixture) => statusOf(fixture) === "ready").length,
    needsReloginCount: statuses.filter((status) => status === "needs-relogin").length,
    expiredCount: statuses.filter((status) => status === "expired").length,
    errorCount: statuses.filter((status) => status === "error").length,
    concurrentAccountsPossible: liveCount >= 3,
    concurrentReason: concurrentBrowserAccountCopy(liveCount),
    lanes: browserAccountLaneBindings({
      targetId: input.targetId,
      fixtures: input.fixtures,
      lanes: input.lanes ?? [],
    }),
  };
}

/** List remembered health, optionally probing live fixtures. Never writes the saved environment. */
export async function collectBrowserTargetAccountHealth(input: {
  projectId: string;
  targetId: string;
  probe?: boolean;
  now?: number;
  url?: string;
  inspectPage?(url: string, context: { reference: string }): Promise<BrowserAuthPageSnapshot>;
}): Promise<{
  fixtures: BrowserAuthenticationFixture[];
  summary: BrowserAccountHealthSummary;
}> {
  const listed = await listBrowserAuthenticationFixtures({
    projectId: input.projectId,
    targetId: input.targetId,
  });
  const attached = await attachBrowserAuthenticationHealth(listed, input.now);
  const fixtures: BrowserAuthenticationFixture[] = [];
  for (const fixture of attached) {
    const listedFixture: BrowserAuthenticationFixture = {
      ...fixture,
      origins: [...fixture.origins],
    };
    if (!input.probe || !browserAuthenticationFixtureIsLive(listedFixture)) {
      fixtures.push(listedFixture);
      continue;
    }
    const probed = await probeBrowserAuthenticationFixture({
      projectId: input.projectId,
      targetId: input.targetId,
      reference: fixture.reference,
      now: input.now,
      url: input.url,
      inspectPage: input.inspectPage
        ? (url) => input.inspectPage!(url, { reference: listedFixture.reference })
        : undefined,
    });
    fixtures.push({
      ...probed.fixture,
      origins: [...probed.fixture.origins],
      health: probed.health,
    });
  }
  const lanes: Lane[] = await listLanes(input.projectId);
  return {
    fixtures,
    summary: summarizeBrowserAccountHealth({
      targetId: input.targetId,
      fixtures,
      lanes,
    }),
  };
}
