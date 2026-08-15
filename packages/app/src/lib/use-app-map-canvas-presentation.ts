import type { CanvasNote } from "@relay/protocol";
import { createMemo, type Accessor, type Setter } from "solid-js";
import type { MapTreeNode } from "./app-map-tree";
import type { CanvasConnection } from "./app-map-connection-draft";
import {
  canvasBounds,
  clampCanvasScale,
  fitCanvasViewport,
  openCanvasViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
  type CanvasScreenRotation,
  type CanvasViewport,
  type ScreenCardGeometry,
} from "./app-map-canvas-layout";
import { centerCanvasViewport, minimapViewportBounds, minimapWorldPoint } from "./app-map-minimap";
import { zoomViewportAtPoint } from "./viewport-zoom";
import {
  buildMinimapEdges,
  buildMinimapNodes,
  buildPresenceGeometry,
  visibleCanvasBoundsFromViewport,
} from "./app-map-workspace-helpers";
import type { useAppMapCanvasGestures } from "../components/use-app-map-canvas-gestures";
import type { AppMapRunPresentationState } from "./app-map-run-projection";

type CanvasGestures = ReturnType<typeof useAppMapCanvasGestures>;

/** Camera, minimap, and presence projections for the App Map canvas. */
export function useAppMapCanvasPresentation(options: {
  view: Accessor<CanvasViewport>;
  setView: Setter<CanvasViewport>;
  nodes: Accessor<MapTreeNode[]>;
  notes: Accessor<CanvasNote[]>;
  connections: Accessor<CanvasConnection[]>;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  geometryForNode: (node: MapTreeNode) => ScreenCardGeometry;
  rotations: Accessor<Record<string, CanvasScreenRotation>>;
  selectedNodeIds: Accessor<string[]>;
  selectedConnectionId: Accessor<string | null>;
  screenStates: Accessor<Record<string, AppMapRunPresentationState | undefined>>;
  transitionStates: Accessor<Record<string, AppMapRunPresentationState | undefined>>;
  gestures: CanvasGestures;
  hasContent: Accessor<boolean>;
  captureOpen: Accessor<boolean>;
  selectedDevicePresent: Accessor<boolean>;
  agentOpen: Accessor<boolean>;
  companionOrientation: Accessor<"portrait" | "landscape" | "square" | "unknown">;
}) {
  const bounds = createMemo(() =>
    canvasBounds(options.nodes(), options.notes(), options.positionFor),
  );
  const usableClientSize = () => {
    const observed = options.gestures.canvasClientSize();
    const element = options.gestures.canvasElement();
    const client = {
      width: element?.clientWidth || observed.width,
      height: element?.clientHeight || observed.height,
    };
    options.companionOrientation();
    const reservesRightSide =
      window.innerWidth > 900 &&
      ((options.captureOpen() && options.selectedDevicePresent()) || options.agentOpen());
    if (!reservesRightSide) return client;
    const panel = element
      ?.closest(".app-map-canvas")
      ?.querySelector<HTMLElement>(".ui-device-companion, [aria-label='Map with AI']");
    const reservedWidth = (panel?.getBoundingClientRect().width ?? 376) + 32;
    return { width: Math.max(320, client.width - reservedWidth), height: client.height };
  };
  const minimapNodes = createMemo(() =>
    buildMinimapNodes({
      nodes: options.nodes(),
      notes: options.notes(),
      bounds: bounds(),
      positionFor: options.positionFor,
      selectedNodeIds: options.selectedNodeIds(),
      screenStates: options.screenStates(),
    }),
  );
  const minimapEdges = createMemo(() =>
    buildMinimapEdges({
      nodes: options.nodes(),
      connections: options.connections(),
      positionFor: options.positionFor,
      geometryForNode: options.geometryForNode,
      sourceRotationFor: (screenId) => options.rotations()[screenId] ?? "none",
      viewportScale: options.view().scale,
      selectedConnectionId: options.selectedConnectionId(),
      transitionStates: options.transitionStates(),
    }),
  );
  const minimapViewport = createMemo(() =>
    minimapViewportBounds(options.view(), usableClientSize(), bounds()),
  );
  const presenceGeometry = createMemo(() =>
    buildPresenceGeometry({
      nodes: options.nodes(),
      connections: options.connections(),
      positionFor: options.positionFor,
      geometryForNode: options.geometryForNode,
      sourceRotationFor: (screenId) => options.rotations()[screenId] ?? "none",
      viewportScale: options.view().scale,
    }),
  );
  const fit = () => {
    if (!options.gestures.canvasElement() || !options.hasContent()) return;
    options.setView(fitCanvasViewport(usableClientSize(), bounds()));
  };
  const openAtReadableScale = () => {
    if (!options.gestures.canvasElement() || !options.hasContent()) return;
    options.setView(openCanvasViewport(usableClientSize(), bounds()));
  };
  const zoom = (scaleDelta: number, clientPoint?: CanvasPoint) => {
    const element = options.gestures.canvasElement();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const anchor = clientPoint
      ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    options.setView((current) =>
      zoomViewportAtPoint(current, clampCanvasScale(current.scale + scaleDelta), anchor),
    );
  };
  const revealScreen = (screenId: string) => {
    const element = options.gestures.canvasElement();
    const node = options.nodes().find((candidate) => candidate.id === screenId);
    if (!element || !node) return;
    const position = options.positionFor(node);
    const scale = Math.max(options.view().scale, 0.72);
    const client = usableClientSize();
    options.setView({
      scale,
      x: client.width / 2 - (position.x + SCREEN_CARD_WIDTH / 2) * scale,
      y: client.height / 2 - (position.y + SCREEN_CARD_HEIGHT / 2) * scale,
    });
    requestAnimationFrame(() => {
      const card = Array.from(
        element.querySelectorAll<HTMLElement>("[data-app-map-screen-id]"),
      ).find((candidate) => candidate.dataset.appMapScreenId === screenId);
      card?.focus({ preventScroll: true });
    });
  };
  const visibleBounds = createMemo(() =>
    visibleCanvasBoundsFromViewport({
      viewport: options.view(),
      client: options.gestures.canvasClientSize(),
    }),
  );
  const navigateMinimap = (ratio: CanvasPoint) => {
    if (!options.gestures.canvasElement()) return;
    options.setView((current) =>
      centerCanvasViewport(current, usableClientSize(), minimapWorldPoint(ratio, bounds())),
    );
  };

  return {
    bounds,
    usableClientSize,
    minimapNodes,
    minimapEdges,
    minimapViewport,
    presenceGeometry,
    fit,
    openAtReadableScale,
    zoom,
    revealScreen,
    visibleBounds,
    navigateMinimap,
  };
}
