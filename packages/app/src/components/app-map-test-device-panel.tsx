import { createMemo, createSignal, Show } from "solid-js";
import { Button } from "@relay/ui/button";
import type { SnapshotNode, SnapshotState } from "../context/server";
import type { InteractiveStep } from "../lib/server-interaction";
import { deviceReadiness } from "../lib/device-readiness";
import {
  companionAccessibilityHighlight,
  companionFramePresentation,
  companionImageLayout,
  companionLogicalViewport,
  companionOrientationEdge,
  companionDisplayedPointToLogical,
} from "./app-map-device-companion-geometry";
import { liveImageStyleFromLayout } from "../lib/stage-presentation";
import { nodeAtPoint } from "../lib/snapshot";
import {
  buildTapTarget,
  logicalBoundsFromCapture,
  semanticTapNode,
  stableLiveTapStep,
} from "../lib/recorder-tap-targeting";
import { TestContextEmpty, formatTestContextTime } from "./app-map-test-context-primitives";
import { Icon } from "./icon";
import { ScrollSurfaceCaptureAction } from "./scroll-surface-capture-action";

export function AppMapTestDevicePanel(props: {
  frame?: {
    base64: string;
    mime: string;
    caption: string;
    capturedAt: number;
    width?: number;
    height?: number;
  };
  snapshot?: SnapshotState;
  platform?: "android" | "ios" | "browser";
  deviceSelected: boolean;
  deviceName?: string;
  readiness: ReturnType<typeof deviceReadiness>;
  offline: boolean;
  refreshing: boolean;
  interacting: boolean;
  interactionBlocker?: string;
  fullPageCapture?: {
    busy: boolean;
    disabledReason?: string;
    policy?: import("@relay/protocol").ScrollSurfaceCapturePolicy;
    hasSurface: boolean;
    onCapture: () => void;
  };
  error: string;
  onRefresh: () => void;
  onInteract: (step: InteractiveStep) => Promise<boolean>;
}) {
  const [imageDimensions, setImageDimensions] = createSignal<
    { width: number; height: number } | undefined
  >();
  const [hoverNode, setHoverNode] = createSignal<SnapshotNode | null>(null);
  const [keyboardPoint, setKeyboardPoint] = createSignal({ x: 0.5, y: 0.5 });
  const [keyboardActive, setKeyboardActive] = createSignal(false);
  const [interactionError, setInteractionError] = createSignal("");
  let pointerDown: { id: number; x: number; y: number } | undefined;

  const presentation = createMemo(() => {
    const frame = props.frame;
    const dimensions =
      frame?.width && frame.height
        ? { width: frame.width, height: frame.height }
        : imageDimensions();
    if (!dimensions) return undefined;
    const nodes = props.snapshot?.nodes;
    const logicalViewport = companionLogicalViewport(nodes);
    const pointScale = logicalViewport
      ? Math.max(dimensions.width, dimensions.height) /
        Math.max(logicalViewport.width, logicalViewport.height)
      : 1;
    return companionFramePresentation({
      frame: dimensions,
      logicalViewport:
        logicalViewport && Number.isFinite(pointScale)
          ? {
              width: logicalViewport.width * pointScale,
              height: logicalViewport.height * pointScale,
            }
          : undefined,
      platform: props.platform,
      edge: companionOrientationEdge(nodes, logicalViewport),
    });
  });
  const rotation = () => presentation()?.rotation ?? "none";
  const layout = createMemo(() => {
    const value = presentation();
    return value ? companionImageLayout(value) : undefined;
  });
  const surfaceAspectRatio = () => layout()?.aspectRatio ?? "9 / 16";
  const hoverHighlight = createMemo(() =>
    companionAccessibilityHighlight(hoverNode(), props.snapshot?.bounds, rotation()),
  );

  function displayedPoint(element: HTMLElement, clientX: number, clientY: number) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const displayed = {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
    return {
      displayed,
      logical: companionDisplayedPointToLogical(displayed, rotation()),
    };
  }

  function interactionAt(fx: number, fy: number): InteractiveStep | null {
    const bounds = logicalBoundsFromCapture({
      snapshot: props.snapshot,
      imageWidth: props.frame?.width ?? imageDimensions()?.width,
      imageHeight: props.frame?.height ?? imageDimensions()?.height,
    });
    if (!bounds) return null;
    const snapshot = props.snapshot ?? null;
    const node = semanticTapNode(snapshot, nodeAtPoint(snapshot, fx, fy));
    return stableLiveTapStep(buildTapTarget(bounds, node, fx, fy));
  }

  async function tapAt(fx: number, fy: number): Promise<void> {
    if (props.interactionBlocker || props.interacting) return;
    const step = interactionAt(fx, fy);
    if (!step) {
      setInteractionError("Relay needs current screen dimensions before it can aim this tap.");
      return;
    }
    setInteractionError("");
    if (!(await props.onInteract(step))) {
      setInteractionError("The tap was not applied. Keep the device unlocked and try again.");
    }
  }

  function updateHover(element: HTMLElement, clientX: number, clientY: number): void {
    const point = displayedPoint(element, clientX, clientY);
    if (!point || props.snapshot?.inspectable === false) {
      setHoverNode(null);
      return;
    }
    const snapshot = props.snapshot ?? null;
    setHoverNode(
      semanticTapNode(snapshot, nodeAtPoint(snapshot, point.logical.x, point.logical.y)),
    );
  }

  function onScreenKeyDown(event: KeyboardEvent): void {
    if (props.interactionBlocker || props.interacting) return;
    const delta = event.shiftKey ? 0.1 : 0.02;
    const current = keyboardPoint();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setKeyboardActive(true);
      setKeyboardPoint({
        x: Math.max(
          0,
          Math.min(
            1,
            current.x +
              (event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            1,
            current.y + (event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0),
          ),
        ),
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setKeyboardActive(true);
      void tapAt(current.x, current.y);
    }
  }
  const message = () =>
    props.readiness.kind === "ready"
      ? undefined
      : props.readiness.kind === "choose-device"
        ? {
            title: "Choose a device",
            detail: "Select a target to see its latest directly observed pixels here.",
          }
        : props.readiness;
  const fullPageFallback = "Open a mapped device screen before capturing its full page.";
  const fullPageDetail = () =>
    props.fullPageCapture
      ? (props.fullPageCapture.disabledReason ??
        props.fullPageCapture.policy?.reason ??
        "Captures every viewport while preserving the original frames and accessibility data.")
      : fullPageFallback;
  return (
    <div class="grid gap-3">
      <header class="flex min-h-11 items-center justify-between gap-3">
        <div class="min-w-0">
          <strong class="block truncate text-[12px] font-semibold text-text-strong">
            {props.deviceName ?? "No device selected"}
          </strong>
          <span class="mt-0.5 block text-[10.5px] text-text-weak" role="status" aria-live="polite">
            {props.refreshing
              ? "Requesting fresh pixels…"
              : props.frame
                ? `${props.offline ? "Last frame" : "Observed"} · ${formatTestContextTime(props.frame.capturedAt)}`
                : (message()?.title ?? "Live pixels available")}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          class="min-h-11 shrink-0"
          disabled={!props.deviceSelected || props.offline || props.refreshing}
          aria-busy={props.refreshing}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" size={13} class={props.refreshing ? "ui-refresh-spin" : undefined} />
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <Show
        when={props.frame}
        fallback={
          <TestContextEmpty
            icon="smartphone"
            title={message()?.title ?? "Waiting for pixels"}
            detail={message()?.detail ?? "Relay has not observed a frame from this device yet."}
          />
        }
      >
        {(frame) => (
          <figure class="m-0 grid min-h-[420px] place-items-center overflow-hidden rounded-xl border border-border-weak-base bg-[var(--map-canvas)] p-3 max-[980px]:min-h-[320px]">
            <div
              role="application"
              tabindex={props.interactionBlocker ? -1 : 0}
              aria-label="Interactive device preview. Tap the screen, or use arrow keys to position the keyboard cursor and Enter to tap."
              aria-disabled={Boolean(props.interactionBlocker)}
              title={props.interactionBlocker ? undefined : "Tap to interact with the device"}
              data-testid="test-device-interaction-surface"
              class={`relative h-[min(720px,calc(100dvh-230px))] max-h-[720px] max-w-full overflow-hidden rounded-lg shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)] outline-none focus-visible:ring-2 focus-visible:ring-border-strong-focus max-[980px]:h-[440px] ${
                props.interactionBlocker ? "cursor-default" : "touch-manipulation cursor-pointer"
              }`}
              style={{ "aspect-ratio": surfaceAspectRatio() }}
              onKeyDown={onScreenKeyDown}
              onFocus={() => setKeyboardActive(true)}
              onBlur={() => setKeyboardActive(false)}
              onPointerDown={(event) => {
                if (props.interactionBlocker || props.interacting || event.button !== 0) return;
                pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) =>
                updateHover(event.currentTarget, event.clientX, event.clientY)
              }
              onPointerLeave={() => setHoverNode(null)}
              onPointerCancel={() => (pointerDown = undefined)}
              onPointerUp={(event) => {
                const start = pointerDown;
                pointerDown = undefined;
                if (
                  !start ||
                  start.id !== event.pointerId ||
                  props.interactionBlocker ||
                  props.interacting
                )
                  return;
                if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) return;
                const point = displayedPoint(event.currentTarget, event.clientX, event.clientY);
                if (point) void tapAt(point.logical.x, point.logical.y);
              }}
            >
              <img
                src={`data:${frame().mime || "image/png"};base64,${frame().base64}`}
                alt={`${props.deviceName ?? "Selected device"}: ${frame().caption || "observed screen"}`}
                draggable={false}
                class="pointer-events-none block h-full w-full select-none object-contain"
                style={liveImageStyleFromLayout(layout())}
                onLoad={(event) =>
                  setImageDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
              <Show when={hoverHighlight()}>
                {(highlight) => (
                  <>
                    <div
                      class="pointer-events-none absolute z-[2] rounded-[3px] border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.14]"
                      style={highlight().rect}
                      aria-hidden="true"
                    />
                    <span
                      class="pointer-events-none absolute z-[3] max-w-[78%] truncate rounded bg-surface-brand-base px-1.5 py-0.5 text-[10px] font-medium text-text-on-brand-base shadow-sm"
                      style={{
                        left: highlight().chip.left,
                        ...(highlight().chip.below
                          ? { top: highlight().chip.bottom }
                          : { top: highlight().chip.top, transform: "translateY(-100%)" }),
                      }}
                      aria-hidden="true"
                    >
                      {highlight().chip.text}
                    </span>
                  </>
                )}
              </Show>
              <Show when={keyboardActive() && !props.interactionBlocker}>
                <span
                  class="pointer-events-none absolute z-[3] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--text-interactive-base)] shadow-sm"
                  style={{
                    left: `${keyboardPoint().x * 100}%`,
                    top: `${keyboardPoint().y * 100}%`,
                  }}
                  aria-hidden="true"
                />
              </Show>
              <Show when={props.interacting}>
                <span
                  class="absolute inset-x-3 bottom-3 z-[4] rounded-md bg-surface-strong-base/90 px-2 py-1.5 text-center text-[11px] font-medium text-text-strong"
                  role="status"
                >
                  Applying tap…
                </span>
              </Show>
            </div>
          </figure>
        )}
      </Show>
      <div class="grid gap-1.5 rounded-xl border border-border-weak-base bg-surface-base p-2.5">
        <ScrollSurfaceCaptureAction
          busy={props.fullPageCapture?.busy ?? false}
          disabledReason={
            props.fullPageCapture ? props.fullPageCapture.disabledReason : fullPageFallback
          }
          policy={props.fullPageCapture?.policy}
          hasSurface={props.fullPageCapture?.hasSurface ?? false}
          statusId="test-scroll-surface-capture-status"
          onCapture={() => props.fullPageCapture?.onCapture()}
        />
        <p id="test-scroll-surface-capture-status" class="m-0 text-[10px]/[1.4] text-text-weak">
          {fullPageDetail()}
        </p>
      </div>
      <Show when={props.interactionBlocker}>
        {(blocker) => <p class="m-0 text-[11px]/[1.45] text-text-weak">View only · {blocker()}</p>}
      </Show>
      <Show when={interactionError()}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          {interactionError()}
        </p>
      </Show>
      <Show when={props.error}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          Pixels were not refreshed. {props.error}
        </p>
      </Show>
    </div>
  );
}
