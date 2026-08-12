import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type {
  ConnectionArrowStyle,
  ConnectionPort,
  ConnectionPresentation,
  ConnectionRouteStyle,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import type { CanvasPoint } from "../lib/app-map-canvas-layout";

type ConnectorPopover = "weight" | "route" | "arrow" | "endpoints";
type ConnectorEndpoint = "source" | "target";

const TOOLBAR_SCREEN_WIDTH = 216;
const TOOLBAR_SCREEN_HEIGHT = 56;
const ENDPOINTS_PANEL_SCREEN_WIDTH = 304;
const COMPACT_PANEL_SCREEN_HEIGHT = 56;
const ENDPOINTS_PANEL_SCREEN_HEIGHT = 172;
const WRAPPED_ENDPOINTS_PANEL_SCREEN_HEIGHT = 268;
const SCREEN_MARGIN = 12;
const SCREEN_GAP = 12;

const controlClass =
  "grid size-11 shrink-0 cursor-pointer place-items-center rounded-[8px] text-[var(--text-base)] transition-[background-color,color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_22%,transparent)] hover:text-[var(--text-interactive-base)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)] active:scale-[0.96] motion-reduce:active:scale-100";

const selectedControlClass =
  "bg-[color-mix(in_srgb,var(--text-interactive-base)_16%,transparent)] text-[var(--text-interactive-base)]";

/**
 * The presentation toolbar is deliberately its own component: it emits one
 * immutable visual patch at a time and knows nothing about canvas persistence.
 * That keeps it usable with the current document store and with a future
 * field-level CRDT adapter alike.
 */
export function AppMapConnectionToolbar(props: {
  connection: CanvasConnection;
  anchor: CanvasPoint;
  viewportScale: number;
  visibleBounds: { left: number; top: number; right: number; bottom: number };
  onChangePresentation: (presentation: ConnectionPresentation | undefined) => void;
}) {
  const [openPopover, setOpenPopover] = createSignal<ConnectorPopover | null>(null);
  let toolbarElement: HTMLDivElement | undefined;
  let popoverElement: HTMLDivElement | undefined;
  let activeTrigger: HTMLButtonElement | undefined;
  const presentation = () => props.connection.presentation ?? {};
  // FigJam-style bent connectors are the dependable default; a cubic is an
  // explicit styling choice and keeps its editable control handle.
  const route = () => presentation().route ?? "elbow";
  const arrow = () => presentation().arrow ?? "end";
  const canvasScale = () => Math.max(props.viewportScale, 0.01);
  const inverseScale = () => 1 / canvasScale();
  const screenToCanvas = (pixels: number) => pixels / canvasScale();
  const clampToRange = (value: number, minimum: number, maximum: number) => {
    if (minimum > maximum) return (minimum + maximum) / 2;
    return Math.min(Math.max(value, minimum), maximum);
  };
  const endpointPanelScreenWidth = () => {
    const viewportScreenWidth =
      (props.visibleBounds.right - props.visibleBounds.left) * canvasScale();
    return Math.min(
      ENDPOINTS_PANEL_SCREEN_WIDTH,
      Math.max(TOOLBAR_SCREEN_WIDTH, viewportScreenWidth - SCREEN_MARGIN * 2),
    );
  };
  const endpointPanelScreenHeight = () =>
    endpointPanelScreenWidth() < ENDPOINTS_PANEL_SCREEN_WIDTH
      ? WRAPPED_ENDPOINTS_PANEL_SCREEN_HEIGHT
      : ENDPOINTS_PANEL_SCREEN_HEIGHT;
  const toolbarLayout = () => {
    const margin = screenToCanvas(SCREEN_MARGIN);
    const gap = screenToCanvas(SCREEN_GAP);
    const toolbarHeight = screenToCanvas(TOOLBAR_SCREEN_HEIGHT);
    // Keep the widest panel (Endpoints) inside the current canvas viewport,
    // rather than letting a connector near an edge produce an unreachable UI.
    const panelHalfWidth = screenToCanvas(endpointPanelScreenWidth() / 2);
    const horizontalMinimum = props.visibleBounds.left + margin + panelHalfWidth;
    const horizontalMaximum = props.visibleBounds.right - margin - panelHalfWidth;
    const verticalMinimum = props.visibleBounds.top + margin;
    const verticalMaximum = props.visibleBounds.bottom - margin - toolbarHeight;
    const belowTop = props.anchor.y + gap;
    const aboveTop = props.anchor.y - gap - toolbarHeight;
    const canPlaceBelow = belowTop <= verticalMaximum;
    const canPlaceAbove = aboveTop >= verticalMinimum;
    const placeBelow = canPlaceBelow || !canPlaceAbove;
    return {
      left: clampToRange(props.anchor.x, horizontalMinimum, horizontalMaximum),
      top: clampToRange(placeBelow ? belowTop : aboveTop, verticalMinimum, verticalMaximum),
    };
  };
  const popoverDirection = () => {
    const selected = openPopover();
    if (!selected) return "above";
    const layout = toolbarLayout();
    const panelHeight = screenToCanvas(
      selected === "endpoints" ? endpointPanelScreenHeight() : COMPACT_PANEL_SCREEN_HEIGHT,
    );
    const gap = screenToCanvas(7);
    const toolbarHeight = screenToCanvas(TOOLBAR_SCREEN_HEIGHT);
    const roomAbove = layout.top - props.visibleBounds.top;
    const roomBelow = props.visibleBounds.bottom - (layout.top + toolbarHeight);
    const wantsAbove = selected !== "endpoints";
    const fitsAbove = roomAbove >= panelHeight + gap;
    const fitsBelow = roomBelow >= panelHeight + gap;
    if (wantsAbove) return fitsAbove || !fitsBelow ? "above" : "below";
    return fitsBelow || !fitsAbove ? "below" : "above";
  };
  const popoverPlacementClass = () =>
    popoverDirection() === "above" ? "bottom-[calc(100%+7px)]" : "top-[calc(100%+7px)]";
  const popoverId = () => `connector-appearance-${props.connection.id}-${openPopover() ?? "panel"}`;

  const update = (patch: Partial<ConnectionPresentation>) => {
    props.onChangePresentation({ ...presentation(), ...patch });
  };

  const closePopover = (restoreFocus = false) => {
    setOpenPopover(null);
    if (!restoreFocus) return;
    queueMicrotask(
      () => activeTrigger?.isConnected && activeTrigger.focus({ preventScroll: true }),
    );
  };

  const togglePopover = (popover: ConnectorPopover, trigger: HTMLButtonElement) => {
    activeTrigger = trigger;
    setOpenPopover((current) => (current === popover ? null : popover));
  };

  // The popover is visually positioned around the toolbar, but it must enter
  // keyboard flow immediately after its trigger. Focus the first choice when
  // it opens so Tab never skips an otherwise visible control group.
  createEffect(() => {
    if (!openPopover()) return;
    queueMicrotask(() =>
      popoverElement
        ?.querySelector<HTMLButtonElement>("button:not([disabled])")
        ?.focus({ preventScroll: true }),
    );
  });

  const selectRoute = (next: ConnectionRouteStyle) => {
    update({ route: next });
    closePopover(true);
  };

  const selectArrow = (next: ConnectionArrowStyle) => {
    update({ arrow: next });
    closePopover(true);
  };

  const selectPort = (endpoint: ConnectorEndpoint, port: ConnectionPort) => {
    if (endpoint === "source") {
      update({
        sourcePort: port,
        ...(port === "auto" ? { sourceOffset: undefined } : {}),
      });
      return;
    }
    update({
      targetPort: port,
      ...(port === "auto" ? { targetOffset: undefined } : {}),
    });
  };

  // A canvas click should behave like clicking outside an ordinary popover.
  // Capture phase keeps this independent from the canvas gesture system.
  createEffect(() => {
    if (!openPopover()) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && toolbarElement?.contains(target)) return;
      closePopover();
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss, true));
  });

  const routeIcon = (value: ConnectionRouteStyle) => (
    <svg viewBox="0 0 20 20" class="size-5 fill-none stroke-current" aria-hidden="true">
      <path
        d={
          value === "elbow"
            ? "M3 16V8a4 4 0 0 1 4-4h10"
            : value === "straight"
              ? "M3 16 17 4"
              : "M3 16C3 7 17 13 17 4"
        }
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );

  const arrowIcon = (value: ConnectionArrowStyle) => (
    <svg viewBox="0 0 20 20" class="size-5 fill-none stroke-current" aria-hidden="true">
      <path d="M3 10h14" stroke-width="1.8" stroke-linecap="round" />
      <Show when={value === "start" || value === "both"}>
        <path
          d="m7.5 5.5-4.5 4.5 4.5 4.5"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <Show when={value === "end" || value === "both"}>
        <path
          d="m12.5 5.5 4.5 4.5-4.5 4.5"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
    </svg>
  );

  const portIcon = (port: ConnectionPort) => (
    <svg viewBox="0 0 20 20" class="size-4 fill-none stroke-current" aria-hidden="true">
      <rect x="6" y="6" width="8" height="8" rx="1.5" stroke-width="1.5" />
      <Show
        when={port !== "auto"}
        fallback={<path d="M10 2v2M10 16v2M2 10h2M16 10h2" stroke-width="1.5" />}
      >
        <path
          d={
            port === "left"
              ? "M2 10h4"
              : port === "right"
                ? "M14 10h4"
                : port === "top"
                  ? "M10 2v4"
                  : "M10 14v4"
          }
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </Show>
    </svg>
  );

  const popover = () => {
    const selected = openPopover();
    if (!selected) return null;
    if (selected === "route") {
      const routes: Array<{ value: ConnectionRouteStyle; label: string }> = [
        { value: "elbow", label: "Bent connector" },
        { value: "curve", label: "Curved connector" },
        { value: "straight", label: "Straight connector" },
      ];
      return (
        <div
          class={cn(
            "absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[11px] border border-[var(--border-base)] bg-[var(--background-base)] p-1.5 shadow-[var(--map-elevation-control)]",
            popoverPlacementClass(),
          )}
          id={popoverId()}
          role="group"
          aria-label="Connector route"
        >
          <For each={routes}>
            {(option) => (
              <button
                type="button"
                class={cn(controlClass, route() === option.value && selectedControlClass)}
                aria-label={option.label}
                title={option.label}
                aria-pressed={route() === option.value}
                onClick={() => selectRoute(option.value)}
              >
                {routeIcon(option.value)}
              </button>
            )}
          </For>
        </div>
      );
    }
    if (selected === "weight") {
      return (
        <div
          class={cn(
            "absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[11px] border border-[var(--border-base)] bg-[var(--background-base)] p-1.5 shadow-[var(--map-elevation-control)]",
            popoverPlacementClass(),
          )}
          id={popoverId()}
          role="group"
          aria-label="Connector line weight"
        >
          <For each={[1, 2, 3] as const}>
            {(weight) => (
              <button
                type="button"
                class={cn(
                  controlClass,
                  (presentation().strokeWidth ?? 2) === weight && selectedControlClass,
                )}
                aria-label={`${weight} pixel line`}
                title={`${weight} pixel line`}
                aria-pressed={(presentation().strokeWidth ?? 2) === weight}
                onClick={() => {
                  update({ strokeWidth: weight });
                  closePopover(true);
                }}
              >
                <svg viewBox="0 0 20 20" class="size-5 stroke-current" aria-hidden="true">
                  <path d="M2 10h16" stroke-width={weight} stroke-linecap="round" />
                </svg>
              </button>
            )}
          </For>
        </div>
      );
    }
    if (selected === "arrow") {
      const arrows: Array<{ value: ConnectionArrowStyle; label: string }> = [
        { value: "none", label: "No arrowheads" },
        { value: "start", label: "Arrow at start" },
        { value: "end", label: "Arrow at end" },
        { value: "both", label: "Arrowheads at both ends" },
      ];
      return (
        <div
          class={cn(
            "absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[11px] border border-[var(--border-base)] bg-[var(--background-base)] p-1.5 shadow-[var(--map-elevation-control)]",
            popoverPlacementClass(),
          )}
          id={popoverId()}
          role="group"
          aria-label="Connector arrowheads"
        >
          <For each={arrows}>
            {(option) => (
              <button
                type="button"
                class={cn(controlClass, arrow() === option.value && selectedControlClass)}
                aria-label={option.label}
                title={option.label}
                aria-pressed={arrow() === option.value}
                onClick={() => selectArrow(option.value)}
              >
                {arrowIcon(option.value)}
              </button>
            )}
          </For>
        </div>
      );
    }

    const ports: Array<{ value: ConnectionPort; label: string }> = [
      { value: "auto", label: "Automatic" },
      { value: "left", label: "Left edge" },
      { value: "right", label: "Right edge" },
      { value: "top", label: "Top edge" },
      { value: "bottom", label: "Bottom edge" },
    ];
    const endpointRow = (endpoint: ConnectorEndpoint, label: string) => {
      const selectedPort = () =>
        (endpoint === "source" ? presentation().sourcePort : presentation().targetPort) ?? "auto";
      return (
        <div class="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-x-2">
          <span class="px-1 text-[11px] font-medium text-[var(--text-weak)]">{label}</span>
          <div class="flex flex-wrap items-center justify-end gap-1">
            <For each={ports}>
              {(option) => (
                <button
                  type="button"
                  class={cn(controlClass, selectedPort() === option.value && selectedControlClass)}
                  aria-label={`${label} on ${option.label.toLowerCase()}`}
                  title={`${label} on ${option.label.toLowerCase()}`}
                  aria-pressed={selectedPort() === option.value}
                  onClick={() => selectPort(endpoint, option.value)}
                >
                  {portIcon(option.value)}
                </button>
              )}
            </For>
          </div>
        </div>
      );
    };
    return (
      <div
        class={cn(
          "absolute left-1/2 -translate-x-1/2 rounded-[11px] border border-[var(--border-base)] bg-[var(--background-base)] p-2 shadow-[var(--map-elevation-control)]",
          popoverPlacementClass(),
        )}
        id={popoverId()}
        role="group"
        aria-label="Connector endpoints"
        style={{ width: `${endpointPanelScreenWidth()}px` }}
      >
        <div class="grid gap-1">
          {endpointRow("source", "From")}
          {endpointRow("target", "To")}
        </div>
        <div class="mt-2 border-t border-[var(--border-base)] pt-2">
          <button
            type="button"
            class="min-h-11 w-full rounded-[8px] px-2 text-left text-xs font-medium text-[var(--text-weak)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--background-hover)] hover:text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] active:scale-[0.99] motion-reduce:active:scale-100"
            onClick={() => {
              props.onChangePresentation(undefined);
              closePopover(true);
            }}
          >
            Reset connector appearance
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      class="absolute z-30"
      data-canvas-shortcuts="ignore"
      ref={(element) => {
        toolbarElement = element;
      }}
      style={{
        left: `${toolbarLayout().left}px`,
        top: `${toolbarLayout().top}px`,
        transform: "translate(-50%, 0)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (openPopover()) {
          event.preventDefault();
          closePopover(true);
        }
      }}
      onFocusOut={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOpenPopover(null);
      }}
    >
      <div
        class="relative"
        style={{
          transform: `scale(${inverseScale()})`,
          "transform-origin": "top center",
        }}
      >
        <div
          class="flex min-h-11 items-center gap-1 rounded-[11px] border border-[var(--border-base)] bg-[var(--background-base)] p-1.5 shadow-[var(--map-elevation-control)]"
          role="toolbar"
          aria-label="Connector appearance"
        >
          <button
            type="button"
            class={cn(controlClass, openPopover() === "weight" && selectedControlClass)}
            aria-label="Connector line weight"
            title="Line weight"
            aria-expanded={openPopover() === "weight"}
            aria-controls={openPopover() === "weight" ? popoverId() : undefined}
            onClick={(event) => togglePopover("weight", event.currentTarget)}
          >
            <svg viewBox="0 0 20 20" class="size-5 stroke-current" aria-hidden="true">
              <path
                d="M2 10h16"
                stroke-width={presentation().strokeWidth ?? 2}
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            class={cn(controlClass, openPopover() === "route" && selectedControlClass)}
            aria-label="Connector route"
            title="Route"
            aria-expanded={openPopover() === "route"}
            aria-controls={openPopover() === "route" ? popoverId() : undefined}
            onClick={(event) => togglePopover("route", event.currentTarget)}
          >
            {routeIcon(route())}
          </button>
          <button
            type="button"
            class={cn(controlClass, openPopover() === "arrow" && selectedControlClass)}
            aria-label="Connector arrowheads"
            title="Arrowheads"
            aria-expanded={openPopover() === "arrow"}
            aria-controls={openPopover() === "arrow" ? popoverId() : undefined}
            onClick={(event) => togglePopover("arrow", event.currentTarget)}
          >
            {arrowIcon(arrow())}
          </button>
          <span class="mx-0.5 h-6 w-px bg-[var(--border-base)]" aria-hidden="true" />
          <button
            type="button"
            class={cn(controlClass, openPopover() === "endpoints" && selectedControlClass)}
            aria-label="Connector endpoints"
            title="Endpoints"
            aria-expanded={openPopover() === "endpoints"}
            aria-controls={openPopover() === "endpoints" ? popoverId() : undefined}
            onClick={(event) => togglePopover("endpoints", event.currentTarget)}
          >
            <svg viewBox="0 0 20 20" class="size-5 fill-none stroke-current" aria-hidden="true">
              <circle cx="4" cy="10" r="2" stroke-width="1.6" />
              <circle cx="16" cy="10" r="2" stroke-width="1.6" />
              <path d="M6 10h8" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div
          class="contents"
          ref={(element) => {
            popoverElement = element;
          }}
        >
          {popover()}
        </div>
      </div>
    </div>
  );
}
