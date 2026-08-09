import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { useServer, type SnapshotNode } from "../context/server";
import {
  accessibilityCollectionEnabled,
  accessibilityHoverEnabled,
} from "../lib/accessibility-overlay-mode";
import { candidateAtPoint, overlayCandidates } from "../lib/snapshot";
import {
  companionAccessibilityHighlight,
  companionAccessibilityOutlineStyles,
  companionDisplayedPointToLogical,
} from "./app-map-device-companion-geometry";

type ImageRotation = "none" | "left" | "right";

/** Accessibility overlay collection and hit testing for the mirrored device. */
export function useDeviceStageAccessibility(options: {
  liveViewActive: Accessor<boolean>;
  imageRotation: Accessor<ImageRotation>;
  refreshSnapshot: (delayMs?: number) => void;
}) {
  const server = useServer();
  const candidates = createMemo(() => {
    const snapshot = server.snapshot();
    if (!snapshot?.nodes?.length || !snapshot.bounds || snapshot.inspectable === false) {
      return [] as SnapshotNode[];
    }
    return overlayCandidates(snapshot.nodes, snapshot.bounds);
  });
  const outlines = createMemo(() => {
    if (server.accessibilityMode() !== "always") return [];
    const snapshot = server.snapshot();
    if (!snapshot?.bounds) return [];
    return companionAccessibilityOutlineStyles(
      snapshot.nodes,
      snapshot.bounds,
      options.imageRotation(),
    );
  });

  const [hoverPoint, setHoverPoint] = createSignal<{ fx: number; fy: number } | null>(null);
  const hoverNode = createMemo(() => {
    const point = hoverPoint();
    const snapshot = server.snapshot();
    if (!point || !snapshot?.bounds) return null;
    return candidateAtPoint(candidates(), snapshot.bounds, point.fx, point.fy);
  });
  const hoverHighlight = createMemo(() =>
    companionAccessibilityHighlight(
      hoverNode(),
      server.snapshot()?.bounds,
      options.imageRotation(),
    ),
  );

  let hoverFrame = 0;
  function scheduleHover(element: HTMLElement, clientX: number, clientY: number): void {
    if (
      !accessibilityHoverEnabled(server.accessibilityMode()) ||
      server.snapshot()?.inspectable === false ||
      hoverFrame
    ) {
      return;
    }
    const rect = element.getBoundingClientRect();
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const displayed = {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
      if (displayed.x < 0 || displayed.x > 1 || displayed.y < 0 || displayed.y > 1) {
        setHoverPoint(null);
        return;
      }
      const logical = companionDisplayedPointToLogical(displayed, options.imageRotation());
      setHoverPoint({ fx: logical.x, fy: logical.y });
    });
  }
  function clearHover(): void {
    if (hoverFrame) cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    setHoverPoint(null);
  }

  createEffect(() => {
    const mode = server.accessibilityMode();
    if (!accessibilityHoverEnabled(mode)) clearHover();
    if (accessibilityCollectionEnabled(mode) && options.liveViewActive()) {
      options.refreshSnapshot(0);
    }
  });
  onCleanup(clearHover);

  return { outlines, hoverHighlight, scheduleHover, clearHover };
}
