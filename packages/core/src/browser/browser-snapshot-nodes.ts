/**
 * Cross-document semantic snapshot collection for managed browsers.
 *
 * The collector walks every frame of the page (bounded), pierces open shadow
 * roots, and expresses every rect in main-viewport CSS coordinates so points
 * derived from the tree can be dispatched as mouse input without further
 * conversion. Nodes are selected by viewport priority — in-viewport
 * interactive controls first — instead of raw document order, so the node
 * budget truncates the least important structure on dense pages. Emission
 * order is tier-major and document-order inside one tier, which keeps the
 * sequence deterministic for a stable screen.
 *
 * Honest bounds, by construction:
 * - closed shadow roots are invisible to every web-layer observer, including
 *   this one;
 * - occlusion is sampled with a center-then-corners hit test inside the
 *   element's own frame; an overlay covering a whole iframe in the parent
 *   document is not attributed, though the frame's position still is;
 * - frames whose element box cannot be measured (detached, not rendered) are
 *   skipped rather than emitted with wrong coordinates.
 */
import type { Frame, Page } from "playwright-core";
import type { SnapshotNode } from "../device/device.js";
/** Cross-origin taps destroy the page's JS world before the after-snapshot. */
export function isBrowserExecutionContextDestroyed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context was destroyed|most likely because of a navigation|Target closed/iu.test(
    message,
  );
}

const INTERACTIVE =
  'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const SEMANTIC_SNAPSHOT = `${INTERACTIVE}, [id], [data-testid], h1, h2, h3, p, label`;
const WRAPPER_TAGS = "div, span, li, td, th, dt, dd";

const MAX_FRAMES = 9;
/** Dense SaaS pages can carry tens of thousands of elements; the walk stays bounded. */
const MAX_VISITED_ELEMENTS = 25_000;

type FrameCollectedNode = {
  /** Pre-order collection sequence inside this frame; parent links use it. */
  order: number;
  /** Nearest collected composed ancestor's order, when one exists. */
  parentOrder?: number;
  rect: { x: number; y: number; width: number; height: number };
  role: string;
  label: string;
  content: string;
  value: string;
  identifier?: string;
  enabled: boolean;
  selected: boolean;
  focused: boolean;
  hittable: boolean;
  interactive: boolean;
  occluded: boolean;
};

type FrameCollection = {
  nodes: FrameCollectedNode[];
  /** Every id/data-testid seen anywhere in the frame, visible or not. An
   * identifier is only a trustworthy locator when it is unique across the
   * whole page, including structure the visibility filter drops. */
  identifiers: string[];
  viewport: { width: number; height: number };
};

/**
 * The serialized in-frame collector. It must stay self-contained: Playwright
 * stringifies this function into each frame's JavaScript world, so nothing
 * outside the `options` argument may close over module state.
 */
function collectFrameNodesInPage(options: {
  interactive: string;
  semantic: string;
  wrappers: string;
  maxVisited: number;
}): FrameCollection {
  // This function is serialized into each frame's JavaScript world. Every
  // helper must therefore be an object-literal method or an inline anonymous
  // arrow: the TypeScript pipeline injects keepNames `__name(...)` statements
  // for function declarations and assigned arrows, and that binding does not
  // exist inside the page.
  const h = {
    visible(element: Element): boolean {
      const check = (element as HTMLElement & { checkVisibility?: (o?: object) => boolean })
        .checkVisibility;
      if (typeof check === "function") {
        try {
          return check.call(element, {
            opacityProperty: true,
            visibilityProperty: true,
            checkVisibilityCSS: true,
          });
        } catch {
          // Older engine objects can reject the options bag; fall through.
        }
      }
      const style = window.getComputedStyle(element);
      return (
        style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0"
      );
    },

    /** Composed parent: ordinary parentElement, or the shadow host when the
     * element hangs directly off a shadow root. */
    composedParent(element: Element): Element | null {
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode();
      return root instanceof ShadowRoot ? root.host : null;
    },

    /** Hit-test one frame-viewport point: is the element itself (or its own
     * subtree/ancestor chain) the painted top there? Hit results retarget
     * shadow content to the host, so the element's own composed ancestor
     * chain — not the hit's tree — decides what counts as itself. */
    hitIsSelf(
      viewport: { width: number; height: number },
      element: Element,
      x: number,
      y: number,
    ): "self" | "other" | "offscreen" {
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return "offscreen";
      const hit = document.elementFromPoint(x, y);
      if (!hit) return "offscreen";
      if (hit === element || element.contains(hit) || hit.contains(element)) return "self";
      for (
        let ancestor = h.composedParent(element), depth = 0;
        ancestor && depth < 32;
        ancestor = h.composedParent(ancestor), depth += 1
      ) {
        if (ancestor === hit) return "self";
      }
      return "other";
    },

    fullyOccluded(
      viewport: { width: number; height: number },
      element: Element,
      rect: DOMRect,
    ): boolean {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const center = h.hitIsSelf(viewport, element, centerX, centerY);
      if (center !== "other") return false;
      // The center is covered by something else. Only a uniformly covered
      // element counts as fully occluded: a sticky header overlapping one
      // strip of a wide row must not erase the whole control.
      const insetX = Math.min(rect.width / 4, 8);
      const insetY = Math.min(rect.height / 4, 8);
      const samples = [
        [rect.x + insetX, rect.y + insetY],
        [rect.x + rect.width - insetX, rect.y + insetY],
        [rect.x + insetX, rect.y + rect.height - insetY],
        [rect.x + rect.width - insetX, rect.y + rect.height - insetY],
      ] as const;
      let sawOtherInViewport = false;
      for (const [x, y] of samples) {
        const hit = h.hitIsSelf(viewport, element, x, y);
        if (hit === "self") return false;
        if (hit === "other") sawOtherInViewport = true;
      }
      return sawOtherInViewport;
    },

    activeElement(): Element | null {
      let active: Element | null = document.activeElement;
      for (let depth = 0; depth < 8; depth += 1) {
        const shadow = (active as HTMLElement | null)?.shadowRoot;
        if (!shadow?.activeElement) break;
        active = shadow.activeElement;
      }
      return active;
    },
  };

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const nodes: FrameCollectedNode[] = [];
  const identifiers: string[] = [];
  const focusedElement = h.activeElement();

  const emittedOrder = new Map<Element, number>();
  let visited = 0;
  let order = 0;
  // Rendered-tree walk: shadow-root children render in place of (or alongside,
  // when slotted) light children. Walking both is correct-by-construction
  // because unrendered light children report zero geometry and drop out.
  const stack: Element[] = [];
  if (document.documentElement) stack.push(document.documentElement);
  while (stack.length && visited < options.maxVisited) {
    const element = stack.pop()!;
    visited += 1;
    const identifier = element.getAttribute("data-testid") || element.id;
    if (identifier) identifiers.push(identifier);
    // Push children reversed so pop order follows document order. Light
    // children are pushed before shadow children, so shadow content is
    // visited first — deterministic either way.
    const shadow = (element as HTMLElement).shadowRoot;
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      stack.push(element.children[index]!);
    }
    if (shadow) {
      for (let index = shadow.children.length - 1; index >= 0; index -= 1) {
        stack.push(shadow.children[index]!);
      }
    }

    const semantic = element.matches(options.semantic);
    if (!semantic) {
      // Plain feature copy is evidence too. Keep only text-bearing wrappers,
      // not every layout div, so extra structure cannot exhaust the budget.
      if (!element.matches(options.wrappers)) continue;
      const hasText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!hasText) continue;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!h.visible(element)) continue;

    const html = element as HTMLElement;
    const input = element as HTMLInputElement;
    const role = semantic ? element.getAttribute("role") || element.tagName.toLowerCase() : "text";
    const hittable = element.matches(options.interactive);
    const renderedText = html.innerText?.trim() ?? "";
    const formControl = /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName);
    const renderedContent = formControl ? String(input.value ?? "") : renderedText;
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      (input.labels?.[0]?.textContent ?? "") ||
      html.innerText?.trim() ||
      input.placeholder ||
      input.name ||
      "";
    let parentOrder: number | undefined;
    for (
      let ancestor = h.composedParent(element);
      ancestor;
      ancestor = h.composedParent(ancestor)
    ) {
      const found = emittedOrder.get(ancestor);
      if (found !== undefined) {
        parentOrder = found;
        break;
      }
    }
    const nodeOrder = order++;
    emittedOrder.set(element, nodeOrder);
    nodes.push({
      order: nodeOrder,
      ...(parentOrder !== undefined ? { parentOrder } : {}),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      role,
      label: label.slice(0, 500),
      content: (input.type === "password" ? "••••••••" : renderedContent).slice(0, 500),
      value:
        input.type === "password"
          ? "••••••••"
          : String(formControl ? (input.value ?? "") : renderedText).slice(0, 500),
      ...(identifier ? { identifier } : {}),
      enabled: !(input.disabled || element.getAttribute("aria-disabled") === "true"),
      selected: element.getAttribute("aria-selected") === "true",
      focused: focusedElement === element,
      hittable,
      interactive: hittable,
      occluded: h.fullyOccluded(viewport, element, rect),
    });
  }
  return { nodes, identifiers, viewport };
}

type PositionedNode = FrameCollectedNode & {
  frameIndex: number;
  x: number;
  y: number;
  inViewport: boolean;
};

/** Interactive controls a person can act on right now come first, then the
 * remaining in-viewport semantics, then off-viewport interactive structure,
 * then everything else. */
function tierOf(node: PositionedNode): number {
  if (node.inViewport && node.interactive) return 0;
  if (node.inViewport) return 1;
  if (node.interactive) return 2;
  return 3;
}

async function frameOffsetInMainViewport(
  frame: Frame,
): Promise<{ x: number; y: number } | undefined> {
  try {
    const element = await frame.frameElement();
    const box = await element.boundingBox();
    if (!box) return undefined;
    return { x: box.x, y: box.y };
  } catch {
    return undefined;
  }
}

async function collectBrowserSnapshotNodesImpl(
  page: Page,
  maxNodes: number,
): Promise<SnapshotNode[]> {
  // A minimal Page-shaped harness (tests, embedded runners) may not implement
  // the frame tree at all; the honest scope then is the document it does have.
  const pageWithFrames = page as Page & {
    mainFrame?: () => Frame;
    frames?: () => Frame[];
  };
  const main =
    typeof pageWithFrames.mainFrame === "function"
      ? pageWithFrames.mainFrame()
      : (page as unknown as Frame);
  const frames = (
    typeof pageWithFrames.frames === "function" ? pageWithFrames.frames() : [main]
  ).slice(0, MAX_FRAMES);
  const collected: Array<{ frame: Frame; collection: FrameCollection }> = [];
  let viewport: { width: number; height: number } | undefined;
  for (const frame of frames) {
    try {
      const collection = await frame.evaluate(collectFrameNodesInPage, {
        interactive: INTERACTIVE,
        semantic: SEMANTIC_SNAPSHOT,
        wrappers: WRAPPER_TAGS,
        maxVisited: MAX_VISITED_ELEMENTS,
      });
      if (frame === main) viewport = collection.viewport;
      collected.push({ frame, collection });
    } catch (error) {
      // A child frame can detach or navigate mid-collection; its content is
      // gone either way, so skipping it is the honest answer. The main frame
      // is the page itself: its failure is the snapshot's failure.
      if (frame === main) throw error;
      if (
        error instanceof Error &&
        !isBrowserExecutionContextDestroyed(error) &&
        !/detached|no frame|was navigated|execution context|frame was detached/i.test(error.message)
      ) {
        throw error;
      }
    }
  }
  const viewportSize = viewport ?? page.viewportSize() ?? { width: 1280, height: 720 };

  const positioned: PositionedNode[] = [];
  for (const [frameIndex, { frame, collection }] of collected.entries()) {
    const offset = frame === main ? { x: 0, y: 0 } : await frameOffsetInMainViewport(frame);
    if (!offset) continue;
    for (const node of collection.nodes) {
      const x = node.rect.x + offset.x;
      const y = node.rect.y + offset.y;
      positioned.push({
        ...node,
        frameIndex,
        x,
        y,
        inViewport:
          x + node.rect.width > 0 &&
          x < viewportSize.width &&
          y + node.rect.height > 0 &&
          y < viewportSize.height,
      });
    }
  }

  // Identifier trust is cross-document: an id duplicated in any frame is not
  // a stable locator, whatever frame it renders in.
  const identifierCounts = new Map<string, number>();
  for (const { collection } of collected) {
    for (const identifier of collection.identifiers) {
      identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
    }
  }

  const usable = positioned.filter((node) => !node.occluded);
  const ranked = usable
    .map((node, index) => ({ node, index }))
    .sort((left, right) => {
      const tierDelta = tierOf(left.node) - tierOf(right.node);
      if (tierDelta !== 0) return tierDelta;
      return left.index - right.index;
    });
  const bounded = ranked.slice(0, maxNodes).map(({ node }) => node);
  const emittedIndex = new Map<string, number>();
  for (const [index, node] of bounded.entries()) {
    emittedIndex.set(`${node.frameIndex}:${node.order}`, index);
  }

  return bounded.map((node, index) => {
    const parentIndex =
      node.parentOrder !== undefined
        ? emittedIndex.get(`${node.frameIndex}:${node.parentOrder}`)
        : undefined;
    return {
      index,
      ...(parentIndex !== undefined && parentIndex !== index ? { parentIndex } : {}),
      role: node.role,
      type: node.role,
      label: node.label,
      content: node.content,
      value: node.value,
      identifier:
        node.identifier && identifierCounts.get(node.identifier) === 1
          ? node.identifier
          : undefined,
      enabled: node.enabled,
      selected: node.selected,
      focused: node.focused,
      visibleToUser: true,
      hittable: node.hittable,
      rect: { x: node.x, y: node.y, width: node.rect.width, height: node.rect.height },
    };
  });
}

/** Bounded semantic snapshot of the page with navigation recovery retained
 * from the evidence collector: a tap that destroys the JS world retries once
 * on the next document. */
export async function snapshotBrowserPageNodes(
  page: Page,
  maxNodes = 256,
): Promise<SnapshotNode[]> {
  const capture = () => collectBrowserSnapshotNodesImpl(page, maxNodes);
  try {
    return await capture();
  } catch (error) {
    if (!isBrowserExecutionContextDestroyed(error)) throw error;
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    return await capture();
  }
}
