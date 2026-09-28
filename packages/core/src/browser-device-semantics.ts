import type { Locator, Page } from "playwright-core";
import type { BrowserDeviceSemanticCandidate } from "@relay/protocol";
import type { SnapshotNode } from "./device.js";

export const MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES = 128;

function bounded(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function semanticCandidate(
  node: SnapshotNode,
  index: number,
): BrowserDeviceSemanticCandidate | null {
  const rect = node.rect;
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  const role = bounded(node.role ?? node.type, 128) ?? "element";
  const label = bounded(node.label, 256);
  const value = bounded(node.value, 256);
  const identifier = bounded(node.identifier, 256);
  const locator = identifier
    ? { strategy: "identifier" as const, value: identifier, exact: true }
    : label
      ? { strategy: "role-name" as const, value: label, role, exact: true }
      : value
        ? { strategy: "text" as const, value, exact: true }
        : undefined;
  const reasoning = identifier
    ? `Stable identifier ${JSON.stringify(identifier)}.`
    : label
      ? `Role ${JSON.stringify(role)} with accessible name ${JSON.stringify(label)}.`
      : value
        ? `Visible text ${JSON.stringify(value)}; review before using it.`
        : "No stable semantic name; coordinate fallback requires explicit review.";
  return {
    id: `candidate-${node.index ?? index}`,
    role,
    ...(label ? { label } : {}),
    ...(value ? { value } : {}),
    ...(identifier ? { identifier } : {}),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    enabled: node.enabled !== false,
    selected: node.selected === true,
    focused: node.focused === true,
    ...(locator ? { locator } : {}),
    reasoning,
  };
}

export function semanticCandidates(nodes: SnapshotNode[]): {
  candidates: BrowserDeviceSemanticCandidate[];
  truncated: boolean;
} {
  const candidates: BrowserDeviceSemanticCandidate[] = [];
  for (const [index, node] of nodes.entries()) {
    // Canonical snapshots also retain visible read-only semantics for
    // assertions. Browser Device overlays are an input surface, so those
    // nodes must never be promoted into clickable candidates.
    if (node.hittable === false) continue;
    const candidate = semanticCandidate(node, index);
    if (candidate) candidates.push(candidate);
  }
  return {
    candidates: candidates.slice(0, MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES),
    truncated: candidates.length > MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES,
  };
}

export function pointInCandidate(
  candidate: BrowserDeviceSemanticCandidate,
  x: number,
  y: number,
): boolean {
  return (
    x >= candidate.rect.x &&
    x <= candidate.rect.x + candidate.rect.width &&
    y >= candidate.rect.y &&
    y <= candidate.rect.y + candidate.rect.height
  );
}

export function semanticLocator(
  page: Page,
  candidate: BrowserDeviceSemanticCandidate,
): Locator | undefined {
  const locator = candidate.locator;
  if (!locator || locator.strategy === "text") return undefined;
  if (locator.strategy === "identifier") {
    // JSON string quoting is valid CSS attribute-value syntax and avoids
    // treating an authored id/test id as executable selector text.
    return page.locator(
      `[id=${JSON.stringify(locator.value)}], [data-testid=${JSON.stringify(locator.value)}]`,
    );
  }
  if (locator.strategy === "label") return page.getByLabel(locator.value, { exact: true });
  const role =
    (
      { a: "link", input: "textbox", textarea: "textbox", select: "combobox" } as Record<
        string,
        string
      >
    )[locator.role ?? ""] ?? locator.role;
  if (!role) return undefined;
  return page.getByRole(role as never, { name: locator.value, exact: locator.exact ?? true });
}
