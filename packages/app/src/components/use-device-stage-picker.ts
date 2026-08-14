import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { useRecorder } from "../context/recorder";
import { useServer, type SnapshotNode } from "../context/server";
import { interactBodyForStrategy } from "../lib/stage-presentation";
import {
  ancestryOf,
  nodeAtPoint,
  stablePointAnchorForNode,
  strategiesFor,
  type PickStrategy,
} from "../lib/snapshot";
import type { HorizontalConstraint, VerticalConstraint } from "../lib/target-inspector";
import {
  companionDisplayedPointToLogical,
  companionLogicalRectToDisplayed,
} from "./app-map-device-companion-geometry";

export type DeviceStagePickerState = {
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  placement: "above" | "below";
  ancestry: SnapshotNode[];
  index: number;
};

/** Owns deliberate accessibility target selection independently of live gestures. */
export function useDeviceStagePicker(options: {
  imageRotation: Accessor<"none" | "left" | "right">;
  stageElement: Accessor<HTMLElement | undefined>;
  showTapFeedback: (displayX: number, displayY: number) => void;
  onInteractionSuccess: () => void;
}) {
  const server = useServer();
  const recorder = useRecorder();
  const [picker, setPicker] = createSignal<DeviceStagePickerState | null>(null);
  const [strategyId, setStrategyId] = createSignal<PickStrategy["id"]>("point");
  const [horizontalConstraint, setHorizontalConstraint] =
    createSignal<HorizontalConstraint>("left");
  const [verticalConstraint, setVerticalConstraint] = createSignal<VerticalConstraint>("top");
  const [manualPoint, setManualPoint] = createSignal<{ x: number; y: number } | null>(null);
  const [coordinateSpace, setCoordinateSpace] = createSignal<"element" | "screen">("screen");
  let pickerElement: HTMLDivElement | undefined;

  const ancestry = () => picker()?.ancestry ?? [];
  const pickerNode = () => {
    const value = picker();
    return value ? (value.ancestry[value.index] ?? null) : null;
  };
  const elementAnchor = createMemo(() => stablePointAnchorForNode(pickerNode()));
  const strategies = createMemo(() => {
    const value = picker();
    return value
      ? strategiesFor(pickerNode(), server.snapshot(), value.fx, value.fy)
      : ([] as PickStrategy[]);
  });
  const constrainedPoint = createMemo(
    () =>
      manualPoint() ??
      strategies().find(
        (strategy): strategy is Extract<PickStrategy, { kind: "point" }> =>
          strategy.kind === "point",
      ),
  );
  const selectedStrategy = createMemo(() => {
    if (strategyId() === "point") {
      const point = constrainedPoint();
      if (point) {
        return {
          id: "point",
          kind: "point",
          x: point.x,
          y: point.y,
          describe: `${point.x}, ${point.y}`,
        } satisfies PickStrategy;
      }
    }
    return strategies().find((strategy) => strategy.id === strategyId()) ?? strategies()[0];
  });
  const highlight = createMemo(() => {
    const node = pickerNode();
    const bounds = server.snapshot()?.bounds;
    if (!node?.rect || !bounds) return null;
    const rect = companionLogicalRectToDisplayed(
      {
        x: node.rect.x / bounds.width,
        y: node.rect.y / bounds.height,
        width: node.rect.width / bounds.width,
        height: node.rect.height / bounds.height,
      },
      options.imageRotation(),
    );
    return {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.width * 100}%`,
      height: `${rect.height * 100}%`,
    };
  });

  function resetCoordinateAnchor(): void {
    setManualPoint(null);
    setHorizontalConstraint("left");
    setVerticalConstraint("top");
    setCoordinateSpace(elementAnchor() ? "element" : "screen");
  }
  function close(): void {
    setPicker(null);
  }
  function retarget(index: number): void {
    setManualPoint(null);
    setPicker((value) =>
      value ? { ...value, index: Math.max(0, Math.min(index, value.ancestry.length - 1)) } : value,
    );
    const next = picker();
    if (!next) return;
    resetCoordinateAnchor();
    setStrategyId(
      strategiesFor(pickerNode(), server.snapshot(), next.fx, next.fy)[0]?.id ?? "point",
    );
  }
  async function pick(strategy: PickStrategy, mode: "tap" | "select"): Promise<void> {
    const value = picker();
    if (!value) return;
    await recorder.flushType();
    close();
    const displayed = companionLogicalRectToDisplayed(
      { x: value.fx, y: value.fy, width: 0, height: 0 },
      options.imageRotation(),
    );
    options.showTapFeedback(displayed.x, displayed.y);

    const constraints = {
      horizontal: horizontalConstraint(),
      vertical: verticalConstraint(),
    };
    if (mode === "select") {
      void recorder.recordPick(
        strategy,
        value.fx,
        value.fy,
        constraints,
        coordinateSpace() === "element" ? elementAnchor() : undefined,
      );
      return;
    }

    const bounds = server.snapshot()?.bounds;
    const tapPoint = bounds
      ? { x: Math.round(value.fx * bounds.width), y: Math.round(value.fy * bounds.height) }
      : undefined;
    let succeeded = await server.interactStep(
      interactBodyForStrategy(strategy, tapPoint),
      `tap ${strategy.describe}`,
    );
    if (!succeeded && strategy.kind !== "point" && tapPoint) {
      succeeded = await server.interactStep(
        { kind: "point", x: tapPoint.x, y: tapPoint.y },
        `tap ${tapPoint.x},${tapPoint.y}`,
      );
    }
    if (succeeded && recorder.recording()) {
      void recorder.recordPick(
        strategy,
        value.fx,
        value.fy,
        constraints,
        coordinateSpace() === "element" ? elementAnchor() : undefined,
      );
    }
    if (succeeded && recorder.interacting()) options.onInteractionSuccess();
  }
  function openAt(image: HTMLImageElement, clientX: number, clientY: number): void {
    const imageBounds = image.getBoundingClientRect();
    const logical = companionDisplayedPointToLogical(
      {
        x: (clientX - imageBounds.left) / imageBounds.width,
        y: (clientY - imageBounds.top) / imageBounds.height,
      },
      options.imageRotation(),
    );
    const node = nodeAtPoint(server.snapshot(), logical.x, logical.y);
    const snapshot = server.snapshot();
    const nodeAncestry = node && snapshot ? ancestryOf(snapshot, node) : node ? [node] : [];
    const stageBounds = options.stageElement()?.getBoundingClientRect();
    const rawX = stageBounds ? clientX - stageBounds.left : clientX - imageBounds.left;
    const rawY = stageBounds ? clientY - stageBounds.top : clientY - imageBounds.top;
    const availableStrategies = strategiesFor(node, snapshot, logical.x, logical.y);
    setPicker({
      fx: logical.x,
      fy: logical.y,
      vx: stageBounds ? Math.max(12, Math.min(rawX, Math.max(12, stageBounds.width - 264))) : rawX,
      vy: rawY,
      placement: rawY < 300 ? "below" : "above",
      ancestry: nodeAncestry,
      index: 0,
    });
    resetCoordinateAnchor();
    setStrategyId(availableStrategies[0]?.id ?? "point");
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!picker()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      retarget((picker()?.index ?? 0) + (event.key === "ArrowUp" ? 1 : -1));
    }
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
    if (!picker() || pickerElement?.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", onOutsidePointerDown, true);
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onOutsidePointerDown, true);
  });

  return {
    picker,
    close,
    openAt,
    pick,
    retarget,
    setPickerElement: (element: HTMLDivElement) => {
      pickerElement = element;
    },
    ancestry,
    pickerNode,
    strategies,
    selectedStrategy,
    strategyId,
    setStrategyId,
    horizontalConstraint,
    setHorizontalConstraint,
    verticalConstraint,
    setVerticalConstraint,
    constrainedPoint,
    setManualPoint,
    coordinateSpace,
    setCoordinateSpace,
    elementAnchor,
    highlight,
  };
}
