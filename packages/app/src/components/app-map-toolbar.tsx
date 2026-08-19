import { Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type AppMapCanvasTool = "select" | "hand";

/**
 * What used to be a permanent floating tab strip over the canvas. The modes it
 * carried now live in the shell's one mode switcher, so all that is left is the
 * transient invitation to review what an agent proposed — and it only appears
 * when there is something to review.
 */
export function AppMapProposalPill(props: {
  count: number;
  shiftForDevice: boolean;
  onOpen: () => void;
}) {
  return (
    <Show when={props.count > 0}>
      <button
        type="button"
        class="absolute top-3 left-1/2 z-20 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--background-base)_94%,transparent)] px-3 text-caption font-medium text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)] backdrop-blur-[14px] transition-[transform,filter] duration-panel ease-drawer hover:brightness-105 motion-reduce:transition-none max-[620px]:top-2"
        style={{
          transform:
            props.shiftForDevice && window.innerWidth > 900
              ? "translateX(calc(-50% - var(--app-map-side-panel-reserve) / 2 + 8px))"
              : "translateX(-50%)",
        }}
        onClick={props.onOpen}
      >
        <Icon name="sparkle" size={12} />
        {props.count} {props.count === 1 ? "proposal" : "proposals"} to review
      </button>
    </Show>
  );
}

export function AppMapToolbar(props: {
  tool: AppMapCanvasTool;
  /** Blank maps have no cards to select or pan — hide canvas tools. */
  mode?: "canvas" | "blank";
  deviceOpen: boolean;
  shiftForDevice: boolean;
  wideDevice: boolean;
  explorationState: "idle" | "running" | "stopping" | "complete" | "error";
  explorationCount: number;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onAddNote: () => void;
  onExplore: () => void;
  onToggleDevice: () => void;
}) {
  const blank = () => props.mode === "blank";
  return (
    <div
      class={cn(
        "absolute bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-20 flex items-center gap-0.5 rounded-xl bg-[color-mix(in_srgb,var(--background-base)_95%,transparent)] p-1 shadow-[var(--map-elevation-panel)] backdrop-blur-[16px] transition-transform duration-panel ease-drawer motion-reduce:transition-none",
      )}
      style={{
        transform:
          props.shiftForDevice && window.innerWidth > 900
            ? "translateX(calc(-50% - var(--app-map-side-panel-reserve) / 2 + 8px))"
            : "translateX(-50%)",
      }}
      role="toolbar"
      aria-label="Map editing tools"
    >
      <Show when={!blank()}>
        <button
          type="button"
          class={cn(mapControlButton, props.tool === "select" && mapControlButtonActive)}
          aria-label="Select tool"
          aria-pressed={props.tool === "select"}
          data-tip="Select and move · V"
          onClick={() => props.onToolChange("select")}
        >
          <Icon name="pointer" size={15} />
          <span class={toolLabel}>Select</span>
        </button>
        <button
          type="button"
          class={cn(mapControlButton, props.tool === "hand" && mapControlButtonActive)}
          aria-label="Hand tool"
          aria-pressed={props.tool === "hand"}
          data-tip="Pan canvas · H"
          onClick={() => props.onToolChange("hand")}
        >
          <Icon name="hand" size={15} />
          <span class={toolLabel}>Hand</span>
        </button>
        <span class="mx-0.5 h-6 w-px bg-[var(--border-weak-base)]" aria-hidden="true" />
      </Show>
      <button
        type="button"
        class={mapControlButton}
        aria-label="Add note"
        data-tip="Add note"
        onClick={props.onAddNote}
      >
        <Icon name="edit" size={15} />
        <span class={toolLabel}>Note</span>
      </button>
      <Show when={!blank()}>
        <button
          type="button"
          class={cn(
            mapControlButton,
            props.explorationState === "running" && mapControlButtonActive,
          )}
          aria-label="Map with AI"
          aria-pressed={props.explorationState === "running"}
          data-tip={
            props.explorationState === "running"
              ? `${props.explorationCount} ${props.explorationCount === 1 ? "agent" : "agents"} exploring · Open progress`
              : "Let Relay explore screens for you"
          }
          onClick={props.onExplore}
        >
          <span class="relative">
            <Icon name="scan" size={15} />
            <Show when={props.explorationState === "running"}>
              <i class="absolute -top-1 -right-1 size-1.5 rounded-full bg-[var(--icon-success-base)] motion-safe:animate-pulse" />
            </Show>
          </span>
          <span class={toolLabel}>
            {props.explorationState === "running" ? "Exploring" : "Map with AI"}
          </span>
        </button>
      </Show>
      <span class="mx-0.5 h-6 w-px bg-[var(--border-weak-base)]" aria-hidden="true" />
      <button
        type="button"
        class={cn(mapControlButton, props.deviceOpen && mapControlButtonActive)}
        aria-label="Toggle live device"
        aria-pressed={props.deviceOpen}
        data-tip="Live device · D"
        onClick={props.onToggleDevice}
      >
        <Icon name="smartphone" size={15} />
        <span class={toolLabel}>Device</span>
      </button>
    </div>
  );
}

const mapControlButton =
  "canvas-tool-control relative inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg px-2.5 text-caption font-medium text-[var(--text-base)] outline-none before:absolute before:-inset-0.5 before:content-[''] transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background-base)] disabled:cursor-not-allowed disabled:opacity-35";

const mapControlButtonActive =
  "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]";

/**
 * A tool nobody can name is a tool nobody uses. The labels drop out only once
 * the canvas is too narrow to spare the width, where the tooltip still answers.
 */
const toolLabel = "max-[1100px]:hidden";
