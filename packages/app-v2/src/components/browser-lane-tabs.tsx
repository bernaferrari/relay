/** @jsxImportSource react */
import { browserLaneHostIdentity, electronGrokLabProductPathBlocker } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { useState } from "react";
import type { ProductAccountLane } from "../data/app-resources-product-service";

const AUTH_LANE_LABELS: Record<string, string> = {
  "grok-auth-email": "Email",
  "grok-auth-gmail": "Gmail",
  "grok-auth-x": "X",
  "grok-auth-x-out": "X out",
  "grok-lab": "SuperGrok",
};

const AUTH_LANE_ORDER = [
  "grok-auth-email",
  "grok-auth-gmail",
  "grok-auth-x",
  "grok-auth-x-out",
  "grok-lab",
] as const;

export type BrowserLaneTab = {
  instanceId: string;
  laneId: string;
  label: string;
  tabSessionKey: string;
  electronPartition: string;
};

export function browserLaneTabLabel(laneId: string): string {
  return AUTH_LANE_LABELS[laneId] ?? laneId;
}

export function isolatedBrowserLanesForTarget(
  lanes: readonly ProductAccountLane[],
  targetId: string,
): ProductAccountLane[] {
  const bound = lanes.filter((lane) => lane.targetId === targetId);
  return AUTH_LANE_ORDER.flatMap((id) => bound.filter((lane) => lane.id === id));
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
  const [activeKey, setActiveKey] = useState<string>();

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
    setActiveKey(tab.tabSessionKey);
    onOpen(tab);
  }

  if (!isolated.length) return null;

  return (
    <section className="relay-browser-lane-tabs mt-4" aria-labelledby="browser-lane-tabs-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2
            id="browser-lane-tabs-title"
            className="text-[13px] font-medium tracking-[-0.01em] text-[var(--text-primary)]"
          >
            Saved configurations
          </h2>
          <p className="mt-0.5 max-w-[42ch] text-[12px] leading-5 text-muted-foreground">
            Each tab is one Lane. Same Lane shares cookies. Different Lanes never do.
          </p>
        </div>
      </div>
      <div
        role="tablist"
        aria-label="Saved configurations"
        className="mt-3 flex flex-wrap gap-1.5 rounded-[14px] border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-[color-mix(in_srgb,var(--surface-muted)_55%,transparent)] p-1"
      >
        {isolated.map((lane) => {
          const host = browserLaneHostIdentity({
            laneId: lane.id,
            targetId: lane.targetId,
            authenticationFixtureId: lane.reference,
          });
          const selected = activeKey === host.tabSessionKey;
          const blocker = browserLaneTabOpenBlocker({
            laneId: lane.id,
            electronGrokLabPartitionPresent,
          });
          return (
            <button
              key={lane.id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={blocker}
              disabled={disabled || Boolean(blocker)}
              onClick={() => openLane(lane)}
              className="relative min-h-9 rounded-[10px] px-3 text-[12.5px] font-medium tracking-[-0.01em] text-muted-foreground transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 active:scale-[0.97] disabled:opacity-50 aria-selected:bg-[var(--background)] aria-selected:text-foreground aria-selected:shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
            >
              {browserLaneTabLabel(lane.id)}
            </button>
          );
        })}
      </div>
      {tabs.length ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Open {tabs.filter((tab) => tab.tabSessionKey === activeKey)[0]?.label ?? "this Lane"} in
          Relay. CLI uses the same id as <code className="font-mono">--lane</code>.
        </p>
      ) : (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={
              disabled ||
              !isolated[0] ||
              Boolean(
                isolated[0] &&
                browserLaneTabOpenBlocker({
                  laneId: isolated[0].id,
                  electronGrokLabPartitionPresent,
                }),
              )
            }
            onClick={() => isolated[0] && openLane(isolated[0])}
          >
            Open first configuration
          </Button>
        </div>
      )}
    </section>
  );
}
