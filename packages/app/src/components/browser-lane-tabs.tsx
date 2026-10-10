/** @jsxImportSource react */
import { browserLaneHostIdentity, electronGrokLabProductPathBlocker } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { useState } from "react";
import type { ProductAccountLane } from "../data/app-resources-product-service";

export type BrowserLaneTab = {
  instanceId: string;
  laneId: string;
  label: string;
  tabSessionKey: string;
  electronPartition: string;
};

/** A saved session's id as people read it: `staging-admin` → "Staging admin". */
export function browserLaneTabLabel(laneId: string): string {
  const words = laneId
    .trim()
    .replaceAll(/[-_.:]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : laneId;
}

export function isolatedBrowserLanesForTarget(
  lanes: readonly ProductAccountLane[],
  targetId: string,
): ProductAccountLane[] {
  return lanes
    .filter((lane) => lane.targetId === targetId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function createBrowserLaneTab(lane: ProductAccountLane): BrowserLaneTab {
  const host = browserLaneHostIdentity({
    laneId: lane.id,
    targetId: lane.targetId,
    authenticationFixtureId: lane.reference,
  });
  return {
    instanceId: `${host.tabSessionKey}:${crypto.randomUUID()}`,
    laneId: host.laneId,
    label: browserLaneTabLabel(host.laneId),
    tabSessionKey: host.tabSessionKey,
    electronPartition: host.electronPartition,
  };
}

export function browserLaneTabOpenBlocker(input: {
  laneId: string;
  electronGrokLabPartitionPresent?: boolean;
}): string | undefined {
  return electronGrokLabProductPathBlocker({
    laneId: input.laneId,
    presentation: "embedded",
    electronGrokLabPartitionPresent: input.electronGrokLabPartitionPresent,
  });
}

export function BrowserLaneTabs({
  lanes,
  targetId,
  disabled,
  onOpen,
  electronGrokLabPartitionPresent,
}: {
  lanes: readonly ProductAccountLane[];
  targetId: string;
  disabled?: boolean;
  electronGrokLabPartitionPresent?: boolean;
  onOpen: (tab: BrowserLaneTab) => void;
}) {
  const isolated = isolatedBrowserLanesForTarget(lanes, targetId);
  const [tabs, setTabs] = useState<BrowserLaneTab[]>([]);

  function openLane(lane: ProductAccountLane) {
    const blocker = browserLaneTabOpenBlocker({
      laneId: lane.id,
      electronGrokLabPartitionPresent,
    });
    if (blocker) throw new Error(blocker);
    const next = createBrowserLaneTab(lane);
    const shared = tabs.find((tab) => tab.tabSessionKey === next.tabSessionKey);
    const tab = shared ?? next;
    if (!shared) setTabs((current) => [...current, tab]);
    onOpen(tab);
  }

  if (!isolated.length) return null;

  return (
    <section className="mt-4" aria-labelledby="browser-lane-tabs-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2
            id="browser-lane-tabs-title"
            className="text-sm font-medium tracking-tight text-foreground"
          >
            Browser sessions
          </h2>
          <p className="mt-0.5 max-w-prose text-xs leading-5 text-muted-foreground">
            Each session keeps its own sign-in.
          </p>
        </div>
      </div>
      <div role="group" aria-label="Open a browser session" className="mt-3 flex flex-wrap gap-2">
        {isolated.map((lane) => {
          const blocker = browserLaneTabOpenBlocker({
            laneId: lane.id,
            electronGrokLabPartitionPresent,
          });
          return (
            <Button
              key={lane.id}
              type="button"
              variant="outline"
              size="sm"
              title={blocker ? "This saved session is not available here." : undefined}
              disabled={disabled || Boolean(blocker)}
              onClick={() => openLane(lane)}
              className="min-h-9"
            >
              Open {browserLaneTabLabel(lane.id)}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
