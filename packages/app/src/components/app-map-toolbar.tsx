import { For, Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type AppMapCanvasTool = "select" | "hand";
export type AppMapWorkspaceView = "map" | "screens" | "coverage";

export function AppMapOverviewToolbar(props: {
  screenCount: number;
  connectionCount: number;
  view: AppMapWorkspaceView;
  proposalCount: number;
  targetSetOpen: boolean;
  activeTargetSetId?: string;
  runTargetLabel: string;
  targetSets: readonly { id: string; name: string }[];
  onTargetSetOpenChange: (open: boolean) => void;
  onChooseTargetSet: (targetSetId?: string) => void;
  onManageTargetSets: () => void;
  onOpenProposals: () => void;
  onViewChange: (view: AppMapWorkspaceView) => void;
}) {
  return (
    <header class="absolute top-4 left-4 z-20 flex min-h-10 items-center gap-1 rounded-[12px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_90%,transparent)] p-1 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-muted)_80%,transparent),0_8px_24px_rgb(0_0_0/14%)] backdrop-blur-[14px]">
      <div class="flex min-w-0 items-center gap-2 px-2 max-[860px]:hidden">
        <span class="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
          <Icon name="move" size={12} />
        </span>
        <span class="whitespace-nowrap text-[10.5px] font-medium text-[var(--text-base)]">
          {props.screenCount} {props.screenCount === 1 ? "screen" : "screens"}
          <span class="mx-1.5 text-[var(--text-weak)]">·</span>
          {props.connectionCount} {props.connectionCount === 1 ? "connection" : "connections"}
        </span>
      </div>
      <span
        class="h-6 w-px bg-[var(--v2-border-border-muted)] max-[860px]:hidden"
        aria-hidden="true"
      />
      <div class="flex items-center gap-0.5" role="tablist" aria-label="App Map view">
        {(
          [
            ["map", "move", "Map"],
            ["screens", "grid", "Screens"],
            ["coverage", "check", "Coverage"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.view === id}
            class={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-2 text-[10.5px] font-medium text-[var(--text-weak)] outline-none transition-[background-color,color] duration-150 hover:text-[var(--text-strong)] focus-visible:ring-1 focus-visible:ring-[var(--text-interactive-base)]",
              props.view === id &&
                "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)] shadow-[0_1px_3px_rgb(0_0_0/10%)]",
            )}
            onClick={() => props.onViewChange(id)}
          >
            <Icon name={icon} size={11} />
            <span class="max-[620px]:hidden">{label}</span>
          </button>
        ))}
      </div>
      <span class="h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <Show when={props.proposalCount > 0}>
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-2 text-[10.5px] font-medium text-[var(--text-interactive-base)] hover:brightness-105"
          onClick={props.onOpenProposals}
        >
          <Icon name="sparkle" size={11} />
          {props.proposalCount} {props.proposalCount === 1 ? "proposal" : "proposals"}
        </button>
        <span class="h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      </Show>
      <div class="relative" data-target-set-picker>
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-2 text-[10.5px] font-medium text-[var(--text-base)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96]"
          aria-expanded={props.targetSetOpen}
          aria-label="Choose where this flow runs"
          onClick={() => props.onTargetSetOpenChange(!props.targetSetOpen)}
        >
          <Icon name="smartphone" size={11} />
          <span class="text-[var(--text-weak)]">Run on</span>
          <span class="max-w-32 truncate text-[var(--text-strong)]">{props.runTargetLabel}</span>
          <Icon name={props.targetSetOpen ? "chevron-up" : "chevron-down"} size={10} />
        </button>
        <Show when={props.targetSetOpen}>
          <div class="ui-pop absolute top-[calc(100%+7px)] left-0 grid w-[286px] gap-1 rounded-[12px] border border-[var(--v2-border-border-strong)] bg-[var(--v2-background-bg-base)] p-1.5 shadow-[var(--v2-elevation-overlay)]">
            <div class="px-2 pt-1 pb-1.5">
              <strong class="block text-[11px] font-semibold text-[var(--text-strong)]">
                Run on
              </strong>
              <span class="mt-0.5 block text-[9.5px]/[1.4] text-[var(--text-weak)]">
                Relay checks the same path on every target in the set.
              </span>
            </div>
            <button
              type="button"
              class={cn(
                "flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] hover:bg-[var(--v2-background-bg-layer-02)]",
                !props.activeTargetSetId && "bg-[var(--product-accent-soft)]",
              )}
              onClick={() => props.onChooseTargetSet()}
            >
              <span class="grid size-7 place-items-center rounded-[7px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                <Icon name="smartphone" size={12} />
              </span>
              <span class="min-w-0 flex-1">
                <strong class="block font-medium text-[var(--text-strong)]">Current device</strong>
                <span class="text-[9.5px] text-[var(--text-weak)]">Fastest while building</span>
              </span>
              <Show when={!props.activeTargetSetId}>
                <Icon name="check" size={11} class="text-[var(--icon-success-base)]" />
              </Show>
            </button>
            <For each={props.targetSets}>
              {(targetSet) => (
                <button
                  type="button"
                  class={cn(
                    "flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] hover:bg-[var(--v2-background-bg-layer-02)]",
                    props.activeTargetSetId === targetSet.id && "bg-[var(--product-accent-soft)]",
                  )}
                  onClick={() => props.onChooseTargetSet(targetSet.id)}
                >
                  <span class="grid size-7 place-items-center rounded-[7px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-interactive-base)]">
                    <Icon name="grid" size={12} />
                  </span>
                  <span class="min-w-0 flex-1 truncate font-medium text-[var(--text-strong)]">
                    {targetSet.name}
                  </span>
                  <Show when={props.activeTargetSetId === targetSet.id}>
                    <Icon name="check" size={11} class="text-[var(--icon-success-base)]" />
                  </Show>
                </button>
              )}
            </For>
            <button
              type="button"
              class="flex min-h-10 items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
              onClick={props.onManageTargetSets}
            >
              <Icon name="plus" size={11} /> Manage target sets…
            </button>
          </div>
        </Show>
      </div>
    </header>
  );
}

export function AppMapToolbar(props: {
  tool: AppMapCanvasTool;
  deviceOpen: boolean;
  shiftForDevice: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyOpen: boolean;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onCaptureScreen: () => void;
  onCreateConnection: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleHistory: () => void;
  onAddNote: () => void;
  onCreateRoutine: () => void;
  onExplore: () => void;
  onToggleDevice: () => void;
}) {
  return (
    <div
      class={cn(
        "absolute bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 flex -translate-x-1/2 items-center gap-1 rounded-[13px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-1.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_76%,transparent),0_16px_46px_rgb(0_0_0/28%)] backdrop-blur-[16px]",
        props.shiftForDevice ? "left-[calc((100%-388px)/2)] max-[900px]:left-1/2" : "left-1/2",
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
        title="Select and move (V)"
        onClick={() => props.onToolChange("select")}
      >
        <Icon name="pointer" size={13} />
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
        title="Pan canvas (H)"
        onClick={() => props.onToolChange("hand")}
      >
        <Icon name="move" size={13} />
      </button>
      <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <button
        type="button"
        class={mapControlButton}
        aria-label="Capture screen"
        data-tip="Capture screen · S"
        onClick={props.onCaptureScreen}
      >
        <Icon name="smartphone" size={13} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Create connection"
        data-tip="Connection · C"
        onClick={props.onCreateConnection}
      >
        <Icon name="arrow-right" size={13} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Undo"
        title="Undo"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <Icon name="undo" size={13} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Redo"
        title="Redo"
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <Icon name="redo" size={13} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-expanded={props.historyOpen}
        aria-label="Map history"
        title="Map history"
        onClick={props.onToggleHistory}
      >
        <Icon name="clock" size={13} />
      </button>
      <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
      <button type="button" class={mapControlButton} title="Add note" onClick={props.onAddNote}>
        <Icon name="edit" size={13} />
        <span class="sr-only">Add note</span>
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Create Routine"
        data-tip="Save as Routine"
        onClick={props.onCreateRoutine}
      >
        <Icon name="copy" size={13} />
      </button>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Explore with Relay"
        data-tip="Explore with AI"
        onClick={props.onExplore}
      >
        <Icon name="sparkle" size={13} />
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
        <Icon name="smartphone" size={13} />
      </button>
    </div>
  );
}

export function AppMapZoomControls(props: {
  percentage: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  return (
    <div class="absolute right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_90%,transparent)] p-1 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-muted)_78%,transparent),0_8px_24px_rgb(0_0_0/16%)] backdrop-blur-[12px] max-[680px]:right-2 max-[680px]:bottom-[calc(68px+env(safe-area-inset-bottom))]">
      <button
        type="button"
        class={mapControlButton}
        aria-label="Zoom out"
        onClick={props.onZoomOut}
      >
        −
      </button>
      <span class="min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
        {props.percentage}%
      </span>
      <button type="button" class={mapControlButton} aria-label="Zoom in" onClick={props.onZoomIn}>
        +
      </button>
      <button type="button" class={mapControlButton} aria-label="Fit map" onClick={props.onFit}>
        Fit
      </button>
    </div>
  );
}

const mapControlButton =
  "canvas-tool-control grid h-10 min-w-10 place-items-center rounded-[9px] px-2 text-[10.5px] text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-35";
