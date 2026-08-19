import { Show, createEffect, createSignal, on } from "solid-js";
import type { Screen } from "@relay/protocol";
import { screenConnectivityLabel } from "../lib/app-map-screen-directory";
import { cn } from "../lib/cn";
import { humanizeTitle } from "../lib/humanize-identifier";
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
  /** How this screen differs from another that carries the same title. */
  qualifier?: string;
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
      class="group min-w-0 rounded-xl bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-3 focus-visible:ring-offset-[var(--map-canvas)]"
      onClick={props.onOpen}
    >
      {/* The frame takes the grid's silhouette, not a fixed landscape box. A
          4/3 frame held a portrait phone capture in about a third of its width
          and filled the rest with nothing, so a grid of phone screens read as a
          grid of empty cards. The grid sets one ratio for every tile in it
          (`--screen-media-aspect`), which keeps a row's baselines aligned while
          letting the screenshot fill the frame it is in. */}
      <div class="relative grid aspect-[var(--screen-media-aspect,0.5)] place-items-center overflow-hidden rounded-xl bg-[var(--background-base)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-shadow duration-hover group-hover:shadow-[inset_0_0_0_1px_var(--border-strong-base),0_8px_20px_rgb(0_0_0/7%)]">
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
              class="absolute top-2 left-2 inline-flex min-h-6 items-center gap-1 rounded-full bg-[var(--surface-base)] px-2 text-micro font-semibold text-[var(--text-base)] shadow-[0_1px_5px_rgb(0_0_0/12%)]"
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
      {/* A fixed two-line name block keeps the grid's baselines aligned while
          letting "Customize appearance" read in full instead of truncating to
          "Customize…". */}
      <div class="grid gap-1 px-1 pt-2.5 pb-1">
        <div class="flex min-w-0 items-start justify-between gap-2">
          <strong
            class="min-h-[2lh] text-body/[1.3] font-semibold text-[var(--text-strong)] [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
            title={humanizeTitle(props.screen.title)}
          >
            {humanizeTitle(props.screen.title)}
          </strong>
          <Icon
            name="arrow-right"
            size={12}
            class="mt-1 shrink-0 text-[var(--text-weak)] opacity-0 transition-opacity duration-hover group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </div>
        {/* Two rows that are each exactly one line, both always reserved. A
            reserved two-line block was not enough on its own: the meta still
            wrapped, so the few tiles carrying a qualifier ran a line longer than
            their neighbours and every row of the grid had a ragged baseline
            under it. Connectivity leads because every screen has it; the
            qualifier and device count share the quieter second line. */}
        <div class="grid min-w-0 gap-y-0.5 text-micro tabular-nums text-[var(--text-weak)]">
          <span class="min-h-[1lh] truncate">{metaLabel(props)}</span>
          <span class="flex min-h-[1lh] min-w-0 items-center gap-1.5 whitespace-nowrap">
            <Show when={props.qualifier}>
              {(qualifier) => (
                <span class="truncate font-medium text-[var(--text-base)]">{qualifier()}</span>
              )}
            </Show>
            <Show when={props.qualifier && props.targets.length}>
              <i class="size-0.5 shrink-0 rounded-full bg-[var(--text-weak)] opacity-60" />
            </Show>
            <Show when={props.targets.length}>
              <span class="shrink-0">
                {props.targets.length} {props.targets.length === 1 ? "device" : "devices"}
              </span>
            </Show>
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyScreenImage() {
  return (
    <div class="grid max-w-[170px] justify-items-center gap-2 px-4 text-center text-[var(--text-weak)] transition-colors duration-hover group-hover:text-[var(--text-base)]">
      <span class="grid size-9 place-items-center rounded-xl bg-[var(--surface-base-hover)]">
        <Icon name="camera" size={15} />
      </span>
      <span class="text-caption font-medium text-[var(--text-base)]">No screenshot</span>
      <span class="text-micro/[1.35]">Open on the map to save one</span>
    </div>
  );
}

function metaLabel(props: {
  screen: Screen;
  incoming: number;
  outgoing: number;
  isStart: boolean;
}): string {
  if (props.screen.handoff) {
    return `Another app · ${props.screen.handoff.returnAction === "back" ? "Back returns" : "Relaunch returns"}`;
  }
  return screenConnectivityLabel(props);
}

function statePill(state: AppMapScreenState): string {
  return cn(
    "inline-flex min-h-5 items-center gap-1 rounded-full bg-[var(--background-base)] px-1.5 text-micro font-semibold shadow-[0_1px_5px_rgb(0_0_0/16%)]",
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
