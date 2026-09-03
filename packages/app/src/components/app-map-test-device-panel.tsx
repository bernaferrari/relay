import { createMemo, createSignal, Show } from "solid-js";
import type { TargetSupervisorHealth } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { productIconButton } from "../lib/ui";
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
import { TargetHealthStatus } from "./target-health-status";

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
  targetHealth?: TargetSupervisorHealth;
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
  recoveryAction?: {
    label: string;
    busy: boolean;
    onAction: () => void;
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
  const recoveryButton = () => (
    <Show when={props.recoveryAction}>
      {(action) => (
        <Button
          variant="secondary"
          size="sm"
          class="shrink-0"
          disabled={action().busy}
          aria-busy={action().busy}
          onClick={action().onAction}
        >
          <Show when={action().busy}>
            <Icon name="refresh" size={12} class="ui-refresh-spin" />
          </Show>
          {action().busy ? "Working…" : action().label}
        </Button>
      )}
    </Show>
  );
  return (
    <div class="grid gap-2.5">
      <header class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <strong class="block truncate text-caption font-medium text-text-strong">
            {props.deviceName ?? "No device selected"}
          </strong>
          <Show when={props.refreshing || props.frame}>
            <span class="block text-caption/[1.3] text-text-weak" role="status" aria-live="polite">
              {props.refreshing
                ? "Requesting fresh pixels…"
                : `${props.offline ? "Last frame" : "Observed"} · ${formatTestContextTime(props.frame!.capturedAt)}`}
            </span>
          </Show>
        </div>
        <button
          type="button"
          class={cn(productIconButton, "size-8")}
          disabled={!props.deviceSelected || props.offline || props.refreshing}
          aria-busy={props.refreshing}
          aria-label={props.refreshing ? "Refreshing pixels" : "Refresh pixels"}
          data-tip="Refresh pixels"
          onClick={props.onRefresh}
        >
          <Icon name="refresh" size={14} class={props.refreshing ? "ui-refresh-spin" : undefined} />
        </button>
      </header>

      <Show when={props.targetHealth}>{(health) => <TargetHealthStatus health={health()} />}</Show>

      <Show
        when={props.frame}
        fallback={
          <div aria-live="polite">
            <TestContextEmpty
              icon="smartphone"
              title={message()?.title ?? "Waiting for live screen"}
              detail={message()?.detail ?? "Relay has not received a screen from this device yet."}
              action={
                props.recoveryAction ? (
                  <div class="mt-3 flex justify-center">{recoveryButton()}</div>
                ) : undefined
              }
            />
          </div>
        }
      >
        {(frame) => (
          <figure class="m-0 grid place-items-center overflow-hidden rounded-lg bg-[var(--map-canvas)] p-2">
            <div
              role="application"
              tabindex={props.interactionBlocker ? -1 : 0}
              aria-label="Interactive device preview. Tap the screen, or use arrow keys to position the keyboard cursor and Enter to tap."
              aria-disabled={Boolean(props.interactionBlocker)}
              title={props.interactionBlocker ? undefined : "Tap to interact with the device"}
              data-testid="test-device-interaction-surface"
              class={cn(
                "relative max-h-[min(620px,calc(100dvh-220px))] w-full max-w-full overflow-hidden rounded-md outline-none",
                "shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)]",
                "focus-visible:ring-2 focus-visible:ring-border-strong-focus",
                props.interactionBlocker ? "cursor-default" : "touch-manipulation cursor-pointer",
              )}
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
                      class="pointer-events-none absolute z-[2] rounded border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.14]"
                      style={highlight().rect}
                      aria-hidden="true"
                    />
                    <span
                      class="pointer-events-none absolute z-[3] max-w-[78%] truncate rounded bg-surface-brand-base px-1.5 py-0.5 text-micro font-medium text-text-on-brand-base shadow-sm"
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
                  class="absolute inset-x-3 bottom-3 z-[4] rounded-md bg-surface-strong-base/90 px-2 py-1.5 text-center text-caption font-medium text-text-strong"
                  role="status"
                >
                  Applying tap…
                </span>
              </Show>
            </div>
          </figure>
        )}
      </Show>
      <Show when={props.frame ? props.interactionBlocker : undefined}>
        {(blocker) => (
          <div class="flex items-center justify-between gap-2 rounded-lg border border-border-weak-base bg-surface-base px-2.5 py-2">
            <p class="m-0 min-w-0 text-caption/[1.4] text-text-weak">{blocker()}</p>
            {recoveryButton()}
          </div>
        )}
      </Show>
      <Show when={interactionError()}>
        <p
          class="m-0 rounded-md border border-border-critical-base bg-surface-critical-weak p-2.5 text-caption/[1.45] text-text-critical-base"
          role="alert"
        >
          {interactionError()}
        </p>
      </Show>
      <Show when={props.error}>
        <p
          class="m-0 rounded-md border border-border-critical-base bg-surface-critical-weak p-2.5 text-caption/[1.45] text-text-critical-base"
          role="alert"
        >
          Pixels were not refreshed. {props.error}
        </p>
      </Show>

      <details class="border-t border-border-weak-base pt-2">
        <summary
          class={cn(
            "flex min-h-8 w-fit cursor-pointer list-none items-center gap-1 rounded",
            "text-caption font-medium text-text-weak hover:text-text-strong",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
          )}
        >
          <Icon name="camera" size={12} />
          Capture this screen
        </summary>
        <div class="grid gap-1.5 pt-1.5">
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
          <p id="test-scroll-surface-capture-status" class="m-0 text-caption/[1.4] text-text-weak">
            {fullPageDetail()}
          </p>
        </div>
      </details>
    </div>
  );
}
