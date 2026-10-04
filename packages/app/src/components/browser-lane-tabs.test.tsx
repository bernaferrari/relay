import { describe, expect, it } from "vitest";
import { browserLaneHostIdentity } from "@relay/protocol";
import type { ProductAccountLane } from "../data/app-resources-product-service";
import {
  browserLaneTabLabel,
  browserLaneTabOpenBlocker,
  createBrowserLaneTab,
  isolatedBrowserLanesForTarget,
} from "./browser-lane-tabs";

const lanes: ProductAccountLane[] = [
  { id: "grok-daily", targetId: "grok-com", kind: "signed-out" },
  { id: "grok-auth-x", targetId: "grok-com", kind: "signed-out" },
  { id: "grok-auth-email", targetId: "grok-com", kind: "signed-out" },
  { id: "grok-lab", targetId: "grok-com", kind: "fixture", reference: "authfx:lab:1" },
  { id: "grok-auth-gmail", targetId: "other", kind: "signed-out" },
];

describe("browser Lane tabs", () => {
  it("keeps one Lane identity for in-app tabs and Electron partitions", () => {
    const gmail = createBrowserLaneTab({
      id: "grok-auth-gmail",
      targetId: "grok-com",
      kind: "signed-out",
    });
    const again = createBrowserLaneTab({
      id: "grok-auth-gmail",
      targetId: "grok-com",
      kind: "signed-out",
    });
    const email = createBrowserLaneTab({
      id: "grok-auth-email",
      targetId: "grok-com",
      kind: "signed-out",
    });
    expect(gmail.tabSessionKey).toBe(again.tabSessionKey);
    expect(gmail.electronPartition).toBe(again.electronPartition);
    expect(gmail.tabSessionKey).not.toBe(email.tabSessionKey);
    expect(gmail.electronPartition).toBe("persist:lane:grok-auth-gmail");
    expect(browserLaneTabLabel("grok-auth-x-out")).toBe("X signed out");
    expect(
      browserLaneHostIdentity({ laneId: "grok-lab", targetId: "grok-com" }).tabSessionKey,
    ).toBe("lane:grok-lab");
  });

  it("lists only isolated auth Lanes for this browser", () => {
    expect(isolatedBrowserLanesForTarget(lanes, "grok-com").map((lane) => lane.id)).toEqual([
      "grok-auth-email",
      "grok-auth-x",
      "grok-lab",
    ]);
  });

  it("refuses Electron grok-lab SuperGrok when persist:lane:grok-lab is unproven", () => {
    expect(browserLaneTabOpenBlocker({ laneId: "grok-lab" })).toMatch(
      /persist:lane:grok-lab is absent/,
    );
    expect(
      browserLaneTabOpenBlocker({
        laneId: "grok-lab",
        electronGrokLabPartitionPresent: false,
      }),
    ).toMatch(/persist:lane:grok-lab is absent/);
    expect(
      browserLaneTabOpenBlocker({
        laneId: "grok-lab",
        electronGrokLabPartitionPresent: true,
      }),
    ).toBeUndefined();
    expect(browserLaneTabOpenBlocker({ laneId: "grok-auth-gmail" })).toBeUndefined();
    expect(() =>
      createBrowserLaneTab({
        id: "grok-lab",
        targetId: "grok-com",
        kind: "fixture",
        reference: "authfx:lab:1",
      }),
    ).not.toThrow();
  });
});
