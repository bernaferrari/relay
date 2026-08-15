import { Show, createEffect, createSignal, on } from "solid-js";
import type { Screen } from "@relay/protocol";
import { cn } from "../lib/cn";
import { AppMapScrollSurfaceBadge } from "./app-map-scroll-surface-badge";
import { Icon } from "./icon";
import { OrientedScreenshot, type ScreenshotOrientationEvidence } from "./oriented-screenshot";

export type AppMapScreenState =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "healed"
  | "blocked"
  | "unknown";

export function AppMapScreenTile(props: {
  screen: Screen;
  image: string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  scrollSurface?: { viewports: readonly unknown[]; status: "completed" | "stopped" };
  state?: AppMapScreenState;
  incoming: number;
  outgoing: number;
  isStart: boolean;
  targets: string[];
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    on(
      () => props.image,
      () => setImageFailed(false),
    ),
  );
  const image = () => (props.image && !imageFailed() ? props.image : "");

  return (
    <button
      type="button"
      class="group min-w-0 rounded-[10px] bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-3 focus-visible:ring-offset-[var(--map-canvas)]"
      onClick={props.onOpen}
    >
      <div class="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[9px] bg-[var(--background-base)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-shadow duration-150 group-hover:shadow-[inset_0_0_0_1px_var(--border-strong-base),0_8px_20px_rgb(0_0_0/7%)]">
        <Show when={image()} fallback={<EmptyScreenImage />}>
          <OrientedScreenshot
            src={image()}
            alt=""
            loading="lazy"
            class="block size-full object-contain"
            evidence={props.orientationEvidence}
            onError={() => setImageFailed(true)}
          />
        </Show>
        <Show when={props.state && props.state !== "idle"}>
          <span class={cn("absolute top-2 right-2", statePill(props.state!))}>
            <i class="size-1.5 rounded-full bg-current" /> {stateLabel(props.state!)}
          </span>
        </Show>
        <Show when={props.screen.handoff}>
          {(handoff) => (
            <span
              class="absolute top-2 left-2 inline-flex min-h-6 items-center gap-1 rounded-full bg-[var(--surface-base)] px-2 text-[9.5px] font-semibold text-[var(--text-base)] shadow-[0_1px_5px_rgb(0_0_0/12%)]"
              title={`Owned by ${handoff().ownerApp} · returns with ${handoff().returnAction}`}
            >
              <Icon name="external" size={10} /> Handoff
            </span>
          )}
        </Show>
        <Show when={props.scrollSurface}>
          {(surface) => (
            <AppMapScrollSurfaceBadge
              viewportCount={surface().viewports.length}
              complete={surface().status === "completed"}
            />
          )}
        </Show>
      </div>
      <div class="grid gap-2 px-1 pt-2.5 pb-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <strong class="truncate text-[12.5px] font-semibold text-[var(--text-strong)]">
            {props.screen.title}
          </strong>
          <Icon
            name="arrow-right"
            size={12}
            class="mt-0.5 shrink-0 text-[var(--text-weak)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </div>
        <div class="flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-weak)]">
          <span class="tabular-nums">{incomingLabel(props)}</span>
          <i class="size-0.5 rounded-full bg-[var(--text-weak)] opacity-60" />
          <span class="tabular-nums">
            {props.outgoing
              ? `${props.outgoing} ${props.outgoing === 1 ? "path" : "paths"} out`
              : "No paths out"}
          </span>
          <Show when={props.targets.length}>
            <i class="size-0.5 rounded-full bg-[var(--text-weak)] opacity-60" />
            <span class="truncate">
              {props.targets.length} {props.targets.length === 1 ? "device" : "devices"}
            </span>
          </Show>
        </div>
      </div>
    </button>
  );
}

function EmptyScreenImage() {
  return (
    <div class="grid max-w-[170px] justify-items-center gap-2 px-4 text-center text-[var(--text-weak)] transition-colors duration-150 group-hover:text-[var(--text-base)]">
      <span class="grid size-9 place-items-center rounded-[10px] bg-[var(--surface-base-hover)]">
        <Icon name="camera" size={15} />
      </span>
      <span class="text-[11px] font-medium text-[var(--text-base)]">No screenshot</span>
      <span class="text-[9.5px]/[1.35]">Open on the map to save one</span>
    </div>
  );
}

function incomingLabel(props: { screen: Screen; incoming: number; isStart: boolean }): string {
  if (props.screen.handoff)
    return `External · ${props.screen.handoff.returnAction === "back" ? "Back to return" : "Relaunch to return"}`;
  if (props.isStart) return "Start screen";
  return props.incoming
    ? `${props.incoming} ${props.incoming === 1 ? "path" : "paths"} in`
    : "No paths in";
}

function statePill(state: AppMapScreenState): string {
  return cn(
    "inline-flex min-h-5 items-center gap-1 rounded-full bg-[var(--background-base)] px-1.5 text-[8.5px] font-semibold shadow-[0_1px_5px_rgb(0_0_0/16%)]",
    state === "passed"
      ? "text-[var(--icon-success-base)]"
      : state === "failed"
        ? "text-[var(--icon-critical-base)]"
        : state === "healed" || state === "blocked"
          ? "text-[var(--icon-warning-base)]"
          : state === "running"
            ? "text-[var(--text-interactive-base)]"
            : "text-[var(--text-weak)]",
  );
}

function stateLabel(state: AppMapScreenState): string {
  return state === "passed"
    ? "Passed"
    : state === "failed"
      ? "Changed"
      : state === "healed"
        ? "Assisted"
        : state === "blocked"
          ? "Blocked"
          : state === "unknown"
            ? "Unknown"
            : "Running";
}
