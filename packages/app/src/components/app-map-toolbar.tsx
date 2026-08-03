import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type AppMapCanvasTool = "select" | "hand";
export type AppMapWorkspaceView = "map" | "screens" | "coverage";

export function AppMapOverviewToolbar(props: {
  screenCount: number;
  connectionCount: number;
  view: AppMapWorkspaceView;
  proposalCount: number;
  shiftForDevice: boolean;
  wideDevice: boolean;
  onOpenProposals: () => void;
  onViewChange: (view: AppMapWorkspaceView) => void;
}) {
  const views = [
    ["map", "map", "Map"],
    ["screens", "grid", "Screens"],
    ["coverage", "check", "Coverage"],
  ] as const;
  const moveViewFocus = (event: KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? views.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    const next = views[nextIndex]![0];
    props.onViewChange(next);
    queueMicrotask(() =>
      document.querySelector<HTMLButtonElement>(`[data-app-map-view="${next}"]`)?.focus(),
    );
  };

  return (
    <header
      class={cn(
        "absolute top-3 z-20 flex min-h-10 -translate-x-1/2 items-center gap-0.5 rounded-[11px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-1 shadow-[var(--map-elevation-control)] backdrop-blur-[14px] transition-[left] duration-180 ease-out motion-reduce:transition-none max-[900px]:left-1/2 max-[620px]:top-2",
        props.shiftForDevice
          ? props.wideDevice
            ? "left-[calc((100%-548px)/2)]"
            : "left-[calc((100%-388px)/2)]"
          : "left-1/2",
      )}
      aria-label={`${props.screenCount} ${props.screenCount === 1 ? "screen" : "screens"}, ${props.connectionCount} ${props.connectionCount === 1 ? "connection" : "connections"}`}
    >
      <div class="flex items-center gap-0.5" role="tablist" aria-label="App Map view">
        {views.map(([id, icon, label], index) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.view === id}
            tabindex={props.view === id ? 0 : -1}
            data-app-map-view={id}
            class={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-[var(--text-weak)] outline-none transition-[background-color,color,box-shadow] duration-150 hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)]",
              props.view === id &&
                "bg-[var(--v2-background-bg-base)] text-[var(--text-strong)] shadow-[0_1px_3px_rgb(0_0_0/12%),inset_0_0_0_1px_var(--v2-border-border-muted)]",
            )}
            onClick={() => props.onViewChange(id)}
            onKeyDown={(event) => moveViewFocus(event, index)}
          >
            <Icon name={icon} size={11} />
            <span class="max-[620px]:hidden">{label}</span>
          </button>
        ))}
      </div>
      <Show when={props.proposalCount > 0}>
        <span class="h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
        <button
          type="button"
          class="inline-flex min-h-10 items-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-2.5 text-[10.5px] font-medium text-[var(--text-interactive-base)] hover:brightness-105"
          onClick={props.onOpenProposals}
        >
          <Icon name="sparkle" size={11} />
          {props.proposalCount} {props.proposalCount === 1 ? "proposal" : "proposals"}
        </button>
      </Show>
    </header>
  );
}

export function AppMapToolbar(props: {
  tool: AppMapCanvasTool;
  deviceOpen: boolean;
  shiftForDevice: boolean;
  wideDevice: boolean;
  explorationState: "idle" | "running" | "stopping" | "complete" | "error";
  explorationCount: number;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onCaptureScreen: () => void;
  onCreateConnection: () => void;
  onAddNote: () => void;
  onExplore: () => void;
  onToggleDevice: () => void;
}) {
  return (
    <div
      class={cn(
        "absolute bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-[12px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_95%,transparent)] p-1 shadow-[var(--map-elevation-panel)] backdrop-blur-[16px]",
        props.shiftForDevice
          ? props.wideDevice
            ? "left-[calc((100%-548px)/2)] max-[900px]:left-1/2"
            : "left-[calc((100%-388px)/2)] max-[900px]:left-1/2"
          : "left-1/2",
      )}
      role="toolbar"
      aria-label="Map editing tools"
    >
      <button
        type="button"
        class={cn(
          mapControlButton,
          props.tool === "select" &&
            "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
        )}
        aria-label="Select tool"
        aria-pressed={props.tool === "select"}
        data-tip="Select and move · V"
        onClick={() => props.onToolChange("select")}
      >
        <Icon name="pointer" size={15} />
      </button>
      <button
        type="button"
        class={cn(
          mapControlButton,
          props.tool === "hand" &&
            "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
        )}
        aria-label="Hand tool"
        aria-pressed={props.tool === "hand"}
        data-tip="Pan canvas · H"
        onClick={() => props.onToolChange("hand")}
      >
        <Icon name="hand" size={15} />
      </button>
      <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <button
        type="button"
        class={mapControlButton}
        aria-label="Capture screenshot"
        data-tip="Capture screenshot · S"
        onClick={props.onCaptureScreen}
      >
        <Icon name="camera" size={15} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Create connection"
        data-tip="Connection · C"
        onClick={props.onCreateConnection}
      >
        <Icon name="arrow-right" size={15} />
      </button>
      <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <button
        type="button"
        class={mapControlButton}
        aria-label="Add note"
        data-tip="Add note"
        onClick={props.onAddNote}
      >
        <Icon name="edit" size={15} />
      </button>
      <button
        type="button"
        class={cn(
          mapControlButton,
          props.explorationState === "running" &&
            "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
        )}
        aria-label="Explore with Relay"
        aria-pressed={props.explorationState === "running"}
        data-tip={
          props.explorationState === "running"
            ? `${props.explorationCount} ${props.explorationCount === 1 ? "agent" : "agents"} exploring · Open progress`
            : "Explore with Relay"
        }
        onClick={props.onExplore}
      >
        <span class="relative">
          <Icon name="scan" size={15} />
          <Show when={props.explorationState === "running"}>
            <i class="absolute -top-1 -right-1 size-1.5 rounded-full bg-[var(--icon-success-base)] motion-safe:animate-pulse" />
          </Show>
        </span>
      </button>
      <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <button
        type="button"
        class={cn(
          mapControlButton,
          props.deviceOpen && "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
        )}
        aria-label="Toggle live device"
        aria-pressed={props.deviceOpen}
        data-tip="Live device · D"
        onClick={props.onToggleDevice}
      >
        <Icon name="smartphone" size={15} />
      </button>
    </div>
  );
}

const mapControlButton =
  "canvas-tool-control grid h-10 min-w-10 place-items-center rounded-[9px] px-2 text-[10.5px] text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--v2-background-bg-base)] disabled:cursor-not-allowed disabled:opacity-35";
