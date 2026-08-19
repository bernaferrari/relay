import type { DiscoveryControl } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { DISCOVERY_APP_PROFILES, type DiscoveryAppProfile } from "./discovery-app-profiles.js";
import { isExploreChromeNode } from "./explore.js";

function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

function contains(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  );
}

function area(rect: { width: number; height: number }): number {
  return Math.max(1, rect.width) * Math.max(1, rect.height);
}

/**
 * Unlabeled header icons, found relative to a profile's tab anchors so LTR/RTL
 * and display-size changes still resolve the same chrome.
 *
 * The anchors come from the profile rather than from this function, and a
 * profile whose anchors are absent contributes nothing — that is what keeps one
 * app's header chrome from being proposed on another app's screen.
 */
export function profileHeaderAffordances(nodes: SnapshotNode[]): DiscoveryControl[] {
  return DISCOVERY_APP_PROFILES.flatMap((profile) => headerAffordances(nodes, profile));
}

function headerAffordances(
  nodes: SnapshotNode[],
  profile: DiscoveryAppProfile,
): DiscoveryControl[] {
  const header = profile.header;
  if (!header) return [];
  const [leadAnchor, secondAnchor] = header.tabAnchors;
  if (!leadAnchor || !secondAnchor) return [];
  const ask = nodes.find((node) => node.label?.trim() === leadAnchor && node.rect);
  const imagine = nodes.find((node) => node.label?.trim() === secondAnchor && node.rect);
  if (!ask?.rect || !imagine?.rect) return [];
  const tabs = nodes.filter(
    (node) => node.rect && header.tabAnchors.includes(node.label?.trim() ?? ""),
  );
  if (!tabs.length) return [];
  const tabMinX = Math.min(...tabs.map((tab) => tab.rect!.x));
  const tabMaxX = Math.max(...tabs.map((tab) => tab.rect!.x + tab.rect!.width));
  const bandY = ask.rect.y + ask.rect.height / 2;
  const icons = nodes.filter((node) => {
    const rect = node.rect;
    if (!rect || node.visibleToUser === false || node.hittable === false) return false;
    if (isExploreChromeNode(node)) return false;
    if ((node.label ?? node.value ?? "").trim()) return false;
    if (Math.abs(rect.y + rect.height / 2 - bandY) > 80) return false;
    return rect.width < 180 && rect.height < 140;
  });
  const ltr = ask.rect.x <= imagine.rect.x;
  const menu = (
    ltr
      ? icons
          .filter((node) => node.rect!.x + node.rect!.width <= tabMinX + 12)
          .sort((a, b) => a.rect!.x - b.rect!.x)
      : icons.filter((node) => node.rect!.x >= tabMaxX - 12).sort((a, b) => b.rect!.x - a.rect!.x)
  )[0];
  const priv = (
    ltr
      ? icons.filter((node) => node.rect!.x >= tabMaxX - 12).sort((a, b) => a.rect!.x - b.rect!.x)
      : icons
          .filter((node) => node.rect!.x + node.rect!.width <= tabMinX + 12)
          .sort((a, b) => b.rect!.x - a.rect!.x)
  )[0];
  const extras: DiscoveryControl[] = [];
  // Prefer the leftmost unlabeled header hit target; fall back to a point in the
  // chrome gutter so CLI summaries that only expose Ask's center still open the drawer.
  const leading = header.leadingAffordance;
  const trailing = header.trailingAffordance;
  if (menu?.rect) {
    extras.push({
      id: `${profile.id}-menu`,
      label: leading,
      // Point only — Android often shares a generic id across header chrome.
      target: { point: center(menu.rect), label: leading },
    });
  } else if (ltr) {
    extras.push({
      id: `${profile.id}-menu`,
      label: leading,
      target: { point: { x: 72, y: Math.round(bandY) }, label: leading },
    });
  }
  if (priv?.rect) {
    extras.push({
      id: `${profile.id}-private`,
      label: trailing,
      target: { point: center(priv.rect), label: trailing },
    });
  }
  return extras;
}

/** Prefer identifier/label over absolute pixels so larger type or RTL still works. */
export function semanticTargetAtPoint(
  nodes: SnapshotNode[],
  point: { x: number; y: number },
): DiscoveryControl["target"] | undefined {
  const hits = nodes
    .filter(
      (node) =>
        node.rect &&
        node.visibleToUser !== false &&
        node.enabled !== false &&
        contains(node.rect, point),
    )
    .sort((left, right) => area(left.rect!) - area(right.rect!));
  for (const hit of hits) {
    if (
      hit.identifier?.trim() &&
      !/(?:^|\/)content$|recycler_view|action_bar/i.test(hit.identifier)
    ) {
      return { identifier: hit.identifier.trim() };
    }
  }
  for (const hit of hits) {
    const label = (hit.label ?? hit.value ?? "").trim();
    if (label && label.length < 80) return { label };
  }
  const chrome = profileHeaderAffordances(nodes);
  for (const item of chrome) {
    const tip = item.target.point;
    if (!tip) continue;
    if (Math.hypot(tip.x - point.x, tip.y - point.y) <= 36) {
      if (item.target.identifier) return { identifier: item.target.identifier };
      return { label: item.label };
    }
  }
  return undefined;
}
