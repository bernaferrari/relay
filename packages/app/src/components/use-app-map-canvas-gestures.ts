import type { AppMapCanvasState } from "@relay/protocol";
import { createMemo, createSignal, onCleanup, type Accessor, type Setter } from "solid-js";
import {
  canvasPointFromClientRect,
  type CanvasEdgeGeometry,
  type CanvasPoint,
  type ScreenCardGeometry,
  type CanvasViewport,
} from "../lib/app-map-canvas-layout";
import { positionsAfterCanvasEdit } from "../lib/app-map-destack";
import {
  APP_MAP_MARQUEE_THRESHOLD,
  canvasSelectionRect,
  connectionIdsInSelection,
  mergeSelectedScreenIds,
  screenIdsInSelection,
  type CanvasSelectionRect,
} from "../lib/app-map-selection";
import {
  snapDraggedScreens,
  type CanvasSnapGuide,
  type CanvasSnapLock,
} from "../lib/app-map-snapping";
import { snapCanvasDeltaToGrid, type CanvasGrid } from "../lib/app-map-grid";

type Marquee = {
  pointerId: number;
  start: CanvasPoint;
  current: CanvasPoint;
  startClient: CanvasPoint;
  baseIds: string[];
  additive: boolean;
  moved: boolean;
};

type NodeDrag = {
  id: string;
  ids: string[];
  x: number;
  y: number;
  origins: Record<string, CanvasPoint>;
  groupId?: string;
  moved: boolean;
  before: AppMapCanvasState;
  snapLocks: CanvasSnapLock[];
};

type NoteDrag = {
  id: string;
  x: number;
  y: number;
  origin: CanvasPoint;
  moved: boolean;
  before: AppMapCanvasState;
};

export function useAppMapCanvasGestures(options: {
  view: Accessor<CanvasViewport>;
  setView: Setter<CanvasViewport>;
  canvasState: Accessor<AppMapCanvasState>;
  setCanvasState: Setter<AppMapCanvasState>;
  screenIds: Accessor<string[]>;
  positions: Accessor<Record<string, CanvasPoint>>;
  geometries: Accessor<Record<string, ScreenCardGeometry>>;
  /** Pure, serializable grid geometry shared by drag and visual presentation. */
  grid: Accessor<CanvasGrid>;
  selectedNodeIds: Accessor<string[]>;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  connectionGeometries: Accessor<readonly { id: string; geometry: CanvasEdgeGeometry }[]>;
  setSelectedConnectionId: (id: string | null) => void;
  clearSecondarySelection: () => void;
  onSelectionSettled: (ids: readonly string[]) => void;
  onCommitNodeDrag: (before: AppMapCanvasState) => void;
  onCommitNoteDrag: (before: AppMapCanvasState) => void;
}) {
  const [canvasElement, setCanvasElement] = createSignal<HTMLElement>();
  const [canvasClientSize, setCanvasClientSize] = createSignal({ width: 0, height: 0 });
  const [selectionMarquee, setSelectionMarquee] = createSignal<Marquee | null>(null);
  const [snapGuides, setSnapGuides] = createSignal<CanvasSnapGuide[]>([]);
  let canvasResizeObserver: ResizeObserver | undefined;
  let pan: { x: number; y: number; view: CanvasViewport } | undefined;
  let nodeDrag: NodeDrag | undefined;
  let noteDrag: NoteDrag | undefined;
  let suppressNodeSelectionClick = false;
  let pointerMoveFrame: number | undefined;
  let pendingPointerMove: CanvasPoint | undefined;

  const observeCanvas = (element: HTMLElement) => {
    setCanvasElement(element);
    canvasResizeObserver?.disconnect();
    setCanvasClientSize({ width: element.clientWidth, height: element.clientHeight });
    if (typeof ResizeObserver === "undefined") return;
    canvasResizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setCanvasClientSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    canvasResizeObserver.observe(element);
  };

  const pointFromClient = (clientX: number, clientY: number): CanvasPoint => {
    const element = canvasElement();
    if (!element) return { x: 0, y: 0 };
    return canvasPointFromClientRect(
      clientX,
      clientY,
      element.getBoundingClientRect(),
      options.view(),
    );
  };

  const marqueeRect = createMemo<CanvasSelectionRect | null>(() => {
    const marquee = selectionMarquee();
    return marquee?.moved ? canvasSelectionRect(marquee.start, marquee.current) : null;
  });

  const applyPointerMove = (clientX: number, clientY: number) => {
    if (!canvasElement()) return;
    const viewport = options.view();
    if (nodeDrag) {
      const moved = Math.hypot(clientX - nodeDrag.x, clientY - nodeDrag.y) > 4;
      if (!moved && !nodeDrag.moved) return;
      if (
        !nodeDrag.moved &&
        !nodeDrag.groupId &&
        !options.selectedNodeIds().includes(nodeDrag.id)
      ) {
        options.setSelectedNodeIds([...nodeDrag.ids]);
        options.setSelectedNodeId(nodeDrag.id);
        options.clearSecondarySelection();
      }
      nodeDrag.moved = true;
      setNodePositions(nodeDrag, clientX, clientY, viewport.scale);
      return;
    }
    if (noteDrag) {
      const moved = Math.hypot(clientX - noteDrag.x, clientY - noteDrag.y) > 4;
      if (!moved && !noteDrag.moved) return;
      noteDrag.moved = true;
      setNotePosition(noteDrag, clientX, clientY, viewport.scale);
      return;
    }
    const marquee = selectionMarquee();
    if (marquee) {
      const moved =
        marquee.moved ||
        Math.hypot(clientX - marquee.startClient.x, clientY - marquee.startClient.y) >
          APP_MAP_MARQUEE_THRESHOLD;
      const current = pointFromClient(clientX, clientY);
      setSelectionMarquee({ ...marquee, current, moved });
      if (!moved) return;
      const hits = screenIdsInSelection(
        options.screenIds(),
        options.positions(),
        canvasSelectionRect(marquee.start, current),
        options.geometries(),
      );
      const selected = mergeSelectedScreenIds(marquee.baseIds, hits, marquee.additive);
      options.setSelectedNodeIds(selected);
      options.setSelectedNodeId(selected.at(-1) ?? null);
      const connectionHits = connectionIdsInSelection(
        options.connectionGeometries().map(({ id, geometry }) => ({
          id,
          hitPoints: geometry.hitPoints,
        })),
        canvasSelectionRect(marquee.start, current),
      );
      if (!selected.length && connectionHits.length === 1) {
        options.clearSecondarySelection();
        options.setSelectedConnectionId(connectionHits[0]!);
      } else {
        options.clearSecondarySelection();
      }
      return;
    }
    if (!pan) return;
    options.setView({
      ...pan.view,
      x: pan.view.x + clientX - pan.x,
      y: pan.view.y + clientY - pan.y,
    });
  };

  const setNodePositions = (drag: NodeDrag, clientX: number, clientY: number, scale: number) => {
    const snap = snapDraggedScreens({
      draggedIds: drag.ids,
      origins: drag.origins,
      positions: options.positions(),
      geometries: options.geometries(),
      grid: options.grid(),
      candidateDelta: {
        x: (clientX - drag.x) / scale,
        y: (clientY - drag.y) / scale,
      },
      // Keep the perceived capture radius constant at every zoom level.
      threshold: 7 / scale,
      previousLocks: drag.snapLocks,
    });
    drag.snapLocks = snap.locks;
    setSnapGuides(snap.guides);
    options.setCanvasState((current) => ({
      ...current,
      positions: positionsAfterCanvasEdit(
        options.positions(),
        Object.fromEntries(
          drag.ids.map((id) => {
            const origin = drag.origins[id]!;
            return [id, { x: origin.x + snap.delta.x, y: origin.y + snap.delta.y }];
          }),
        ),
      ),
    }));
  };

  const setNotePosition = (drag: NoteDrag, clientX: number, clientY: number, scale: number) => {
    const delta = snapCanvasDeltaToGrid(
      drag.origin,
      {
        x: (clientX - drag.x) / scale,
        y: (clientY - drag.y) / scale,
      },
      options.grid(),
    );
    options.setCanvasState((current) => ({
      ...current,
      notes: (current.notes ?? []).map((note) =>
        note.id === drag.id
          ? {
              ...note,
              x: drag.origin.x + delta.x,
              y: drag.origin.y + delta.y,
              updatedAt: Date.now(),
            }
          : note,
      ),
    }));
  };

  const schedulePointerMove = (clientX: number, clientY: number) => {
    pendingPointerMove = { x: clientX, y: clientY };
    if (pointerMoveFrame !== undefined) return;
    pointerMoveFrame = requestAnimationFrame(() => {
      pointerMoveFrame = undefined;
      const pending = pendingPointerMove;
      pendingPointerMove = undefined;
      if (pending) applyPointerMove(pending.x, pending.y);
    });
  };

  const flushPointerMove = (clientX: number, clientY: number) => {
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = undefined;
    pendingPointerMove = undefined;
    applyPointerMove(clientX, clientY);
  };

  const beginPan = (clientX: number, clientY: number) => {
    pan = { x: clientX, y: clientY, view: options.view() };
  };

  const beginMarquee = (event: PointerEvent) => {
    const point = pointFromClient(event.clientX, event.clientY);
    options.clearSecondarySelection();
    setSelectionMarquee({
      pointerId: event.pointerId,
      start: point,
      current: point,
      startClient: { x: event.clientX, y: event.clientY },
      baseIds: event.shiftKey ? [...options.selectedNodeIds()] : [],
      additive: event.shiftKey,
      moved: false,
    });
  };

  const beginNodeDrag = (drag: Omit<NodeDrag, "moved" | "before" | "snapLocks">) => {
    nodeDrag = {
      ...drag,
      moved: false,
      before: structuredClone(options.canvasState()),
      snapLocks: [],
    };
  };

  const beginNoteDrag = (drag: Omit<NoteDrag, "moved" | "before">) => {
    noteDrag = { ...drag, moved: false, before: structuredClone(options.canvasState()) };
  };

  const finishPointer = (event: PointerEvent) => {
    flushPointerMove(event.clientX, event.clientY);
    const marquee = selectionMarquee();
    if (marquee?.pointerId === event.pointerId) {
      if (!marquee.moved && !marquee.additive) {
        options.setSelectedNodeIds([]);
        options.setSelectedNodeId(null);
        options.onSelectionSettled([]);
      } else if (marquee.moved) {
        options.onSelectionSettled(options.selectedNodeIds());
      }
      setSelectionMarquee(null);
      setSnapGuides([]);
      return;
    }
    if (nodeDrag?.moved) {
      options.onCommitNodeDrag(nodeDrag.before);
      suppressNodeSelectionClick = true;
      queueMicrotask(() => {
        suppressNodeSelectionClick = false;
      });
    }
    if (noteDrag?.moved) options.onCommitNoteDrag(noteDrag.before);
    clearActiveGesture();
  };

  const clearActiveGesture = () => {
    nodeDrag = undefined;
    noteDrag = undefined;
    pan = undefined;
    setSnapGuides([]);
  };

  const cancelPointer = () => {
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = undefined;
    pendingPointerMove = undefined;
    clearActiveGesture();
    cancelMarquee();
  };

  const cancelMarquee = () => {
    const marquee = selectionMarquee();
    if (!marquee) return false;
    options.setSelectedNodeIds(marquee.baseIds);
    options.setSelectedNodeId(marquee.baseIds.at(-1) ?? null);
    setSelectionMarquee(null);
    return true;
  };

  onCleanup(() => {
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
    canvasResizeObserver?.disconnect();
  });

  return {
    beginMarquee,
    beginNodeDrag,
    beginNoteDrag,
    beginPan,
    cancelMarquee,
    cancelPointer,
    canvasClientSize,
    canvasElement,
    finishPointer,
    marqueeRect,
    snapGuides,
    nodeSelectionSuppressed: () => suppressNodeSelectionClick,
    observeCanvas,
    pointFromClient,
    schedulePointerMove,
  };
}
