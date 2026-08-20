import { onCleanup, type Accessor } from "solid-js";
import { companionDisplayedPointToLogical } from "./app-map-device-companion-geometry";
import type { DeviceInteractionGesture } from "./device-interaction-surface";

type LogicalPoint = { x: number; y: number };
type DisplayedPoint = LogicalPoint;

type PendingMove = {
  fx: number;
  fy: number;
  displayFx: number;
  displayFy: number;
  pointerId: number;
};

/**
 * Owns the optional low-latency Android transport beneath the one canonical
 * recorder gesture. The Stage deliberately receives only callbacks and visual
 * refs: it never has to know whether pixels come from a PNG, H.264, iOS, or
 * scrcpy.
 */
export function useDeviceStageLiveGesture(props: {
  platform: Accessor<string | undefined>;
  rotation: Accessor<"none" | "left" | "right">;
  sendTouch: (
    action: "down" | "move" | "up" | "cancel",
    fx: number,
    fy: number,
  ) => Promise<boolean>;
  sendWheel: (fx: number, fy: number, scrollX: number, scrollY: number) => Promise<boolean>;
  driveSwipe: (
    from: LogicalPoint,
    to: LogicalPoint,
    durationMs: number,
    alreadyApplied: boolean,
  ) => Promise<boolean>;
  interacting: Accessor<boolean>;
  invalidateSemanticOverlay: () => void;
  scheduleSnapshot: () => void;
}) {
  let touchChain = Promise.resolve(false);
  let activePointerId: number | undefined;
  let completedTransport = Promise.resolve(false);
  let pendingMove: PendingMove | null = null;
  let gestureMoveRaf = 0;
  let trail: HTMLDivElement | undefined;
  let trailLine: SVGLineElement | undefined;
  let trailHead: HTMLElement | undefined;
  let trailTimer: number | undefined;
  let pendingWheel: { fx: number; fy: number; dx: number; dy: number } | null = null;
  let wheelBurst: { startedAt: number; dx: number; dy: number } | null = null;
  let wheelChain = Promise.resolve(false);
  let wheelSent = false;
  let wheelRaf = 0;
  let wheelEndTimer: number | undefined;

  function paintTrail(from: DisplayedPoint, to: DisplayedPoint): void {
    if (!trail || !trailLine || !trailHead) return;
    trail.style.opacity = "1";
    trailLine.setAttribute("x1", String(from.x * 100));
    trailLine.setAttribute("y1", String(from.y * 100));
    trailLine.setAttribute("x2", String(to.x * 100));
    trailLine.setAttribute("y2", String(to.y * 100));
    trailHead.style.left = `${to.x * 100}%`;
    trailHead.style.top = `${to.y * 100}%`;
  }

  function settleTrail(): void {
    if (!trail) return;
    if (trailTimer) clearTimeout(trailTimer);
    trailTimer = window.setTimeout(() => {
      if (trail) trail.style.opacity = "0";
    }, 120);
  }

  function queueTouch(
    action: "down" | "move" | "up" | "cancel",
    fx: number,
    fy: number,
  ): Promise<boolean> {
    // The low-latency lifecycle exists only for Android. iOS receives exactly
    // one canonical XCTest action after the gesture ends.
    if (props.platform() !== "android") return Promise.resolve(false);
    const send = () => props.sendTouch(action, fx, fy);
    touchChain = action === "down" ? send() : touchChain.then((ready) => (ready ? send() : false));
    return touchChain;
  }

  function flushPendingMove(pointerId: number): void {
    if (gestureMoveRaf) {
      cancelAnimationFrame(gestureMoveRaf);
      gestureMoveRaf = 0;
    }
    const move = pendingMove;
    pendingMove = null;
    if (move?.pointerId === pointerId) void queueTouch("move", move.fx, move.fy);
  }

  function onGesture(gesture: DeviceInteractionGesture): void {
    const { logical, displayed } = gesture.point;
    if (gesture.phase === "down") {
      activePointerId = gesture.pointerId;
      completedTransport = queueTouch("down", logical.x, logical.y);
      if (trailTimer) clearTimeout(trailTimer);
      paintTrail(displayed, displayed);
      return;
    }
    if (activePointerId !== gesture.pointerId) return;
    if (gesture.phase === "move") {
      pendingMove = {
        fx: logical.x,
        fy: logical.y,
        displayFx: displayed.x,
        displayFy: displayed.y,
        pointerId: gesture.pointerId,
      };
      if (!gestureMoveRaf) {
        gestureMoveRaf = requestAnimationFrame(() => {
          gestureMoveRaf = 0;
          const move = pendingMove;
          pendingMove = null;
          if (move && activePointerId === move.pointerId) {
            paintTrail(gesture.start.displayed, { x: move.displayFx, y: move.displayFy });
            void queueTouch("move", move.fx, move.fy);
          }
        });
      }
      return;
    }
    flushPendingMove(gesture.pointerId);
    activePointerId = undefined;
    completedTransport = queueTouch(gesture.phase, logical.x, logical.y);
    paintTrail(gesture.start.displayed, displayed);
    settleTrail();
  }

  function flushWheel(): void {
    if (wheelRaf) {
      cancelAnimationFrame(wheelRaf);
      wheelRaf = 0;
    }
    const wheel = pendingWheel;
    pendingWheel = null;
    if (!wheel) return;
    // scrcpy accepts signed units in [-1, 1]. DOM wheel signs are opposite
    // Android's scroll axis, so a wheel-down becomes content moving upward.
    const scrollX = Math.max(-1, Math.min(1, -wheel.dx / 80));
    const scrollY = Math.max(-1, Math.min(1, -wheel.dy / 80));
    const send = () => props.sendWheel(wheel.fx, wheel.fy, scrollX, scrollY);
    wheelChain = wheelSent ? wheelChain.then((ready) => (ready ? send() : false)) : send();
    wheelSent = true;
  }

  function finishWheelBurst(): void {
    flushWheel();
    const burst = wheelBurst;
    wheelBurst = null;
    wheelEndTimer = undefined;
    if (!burst) return;
    const from = companionDisplayedPointToLogical({ x: 0.5, y: 0.5 }, props.rotation());
    const to = companionDisplayedPointToLogical(
      {
        x: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dx / 600)),
        y: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dy / 600)),
      },
      props.rotation(),
    );
    const durationMs = Math.round(Math.max(80, Math.min(performance.now() - burst.startedAt, 600)));
    props.invalidateSemanticOverlay();
    void wheelChain.then((live) =>
      props.driveSwipe(from, to, durationMs, live).then(() => {
        if (props.interacting()) props.scheduleSnapshot();
      }),
    );
  }

  function queueWheel(point: LogicalPoint, deltaX: number, deltaY: number): void {
    if (!wheelBurst) {
      wheelBurst = { startedAt: performance.now(), dx: 0, dy: 0 };
      wheelSent = false;
    }
    wheelBurst.dx += deltaX;
    wheelBurst.dy += deltaY;
    pendingWheel = pendingWheel
      ? {
          fx: point.x,
          fy: point.y,
          dx: pendingWheel.dx + deltaX,
          dy: pendingWheel.dy + deltaY,
        }
      : { fx: point.x, fy: point.y, dx: deltaX, dy: deltaY };
    if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    wheelEndTimer = window.setTimeout(finishWheelBurst, 90);
  }

  onCleanup(() => {
    if (gestureMoveRaf) cancelAnimationFrame(gestureMoveRaf);
    if (wheelRaf) cancelAnimationFrame(wheelRaf);
    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    if (trailTimer) clearTimeout(trailTimer);
  });

  return {
    onGesture,
    queueWheel,
    completedTransport: () => completedTransport,
    setTrail: (element: HTMLDivElement) => {
      trail = element;
    },
    setTrailLine: (element: SVGLineElement) => {
      trailLine = element;
    },
    setTrailHead: (element: HTMLElement) => {
      trailHead = element;
    },
  };
}
