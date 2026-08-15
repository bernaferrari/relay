import { For, Show } from "solid-js";
import type { AppMap, MapGroup } from "@relay/protocol";
import { IconButton } from "@relay/ui/icon-button";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import type { MapTreeNode } from "../lib/app-map-tree";
import { cn } from "../lib/cn";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import { useAppMapScrollSurface } from "../lib/use-app-map-scroll-surface";
import { Icon } from "./icon";
import { OrientedScreenshot, type ScreenshotOrientationEvidence } from "./oriented-screenshot";
import { LogicalScrollSurfaceViewer } from "./logical-scroll-surface-viewer";

export function ScreenInspector(props: {
  node: MapTreeNode | null;
  appMap?: AppMap;
  title: string;
  image?: string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  runState?: AppMapRunPresentationState;
  isFlowStart?: boolean;
  connections: CanvasConnection[];
  titleForScreen: (screenId: string) => string;
  flowSetup?: {
    flowCount: number;
    mixed: boolean;
    routineId?: string;
    routines: Array<{ id: string; name: string }>;
  };
  onFlowSetup: (routineId?: string) => void;
  onSelectConnection: (connection: CanvasConnection) => void;
  onRename: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const scrollSurface = useAppMapScrollSurface({
    activeAppMap: () => props.appMap,
    screenId: () => props.node?.id,
  });
  return (
    <Show when={props.node}>
      {(_node) => (
        <aside
          id={`app-map-screen-details-${_node().id}`}
          data-app-map-screen-inspector
          class="app-map-panel-scroll absolute top-16 right-3 z-30 max-h-[calc(100%-144px)] w-[min(304px,calc(100%-24px))] touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain rounded-[13px] border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--background-base)_97%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[14px] max-[720px]:top-auto max-[720px]:right-3 max-[720px]:bottom-[calc(72px+env(safe-area-inset-bottom))] max-[720px]:left-3 max-[720px]:max-h-[min(70%,540px)] max-[720px]:w-auto"
          aria-label={`Details for ${props.title}`}
          data-app-map-native-scroll
          onWheel={(event) => event.stopPropagation()}
        >
          <header class="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-weak-base)] px-2.5">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                <Icon name="info" size={12} />
              </span>
              <button
                type="button"
                class="min-w-0 truncate rounded-[6px] px-1 py-0.5 text-left text-[13px]/[1.2] font-semibold text-[var(--text-strong)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-strong-focus)]"
                aria-label={`Rename ${props.title}`}
                data-tip="Rename screen · F2"
                onClick={props.onRename}
              >
                <strong class="block truncate font-semibold">{props.title}</strong>
              </button>
            </div>
            <IconButton
              variant="ghost"
              size="md"
              aria-label="Close screen details"
              onClick={props.onClose}
            >
              <Icon name="x" size={12} />
            </IconButton>
          </header>

          <section class="grid grid-cols-[72px_minmax(0,1fr)] gap-3 p-3">
            <div class="flex h-[88px] items-center justify-center overflow-hidden rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--background-deep)] p-1.5">
              <Show
                when={props.image}
                fallback={<Icon name="smartphone" size={18} class="text-[var(--text-weaker)]" />}
              >
                {(image) => (
                  <OrientedScreenshot
                    src={image()}
                    alt={`Preview of ${props.title}`}
                    class="block h-full w-full object-contain"
                    evidence={props.orientationEvidence}
                  />
                )}
              </Show>
            </div>
            <div class="grid content-center gap-2 text-[10.5px] text-[var(--text-weak)]">
              <div class="flex items-center gap-2">
                <i
                  class={cn(
                    "size-1.5 rounded-full",
                    props.image ? "bg-[var(--text-interactive-base)]" : "bg-[var(--text-weaker)]",
                  )}
                  aria-hidden="true"
                />
                <span>{props.image ? "Screenshot saved" : "No screenshot"}</span>
              </div>
              <Show when={props.isFlowStart}>
                <div class="flex items-center gap-2">
                  <Icon name="play" size={10} />
                  <span>Start screen</span>
                </div>
              </Show>
              <Show when={props.runState && props.runState !== "idle"}>
                <div
                  class={cn(
                    "flex items-center gap-2 font-medium capitalize",
                    props.runState === "failed"
                      ? "text-[var(--icon-critical-base)]"
                      : props.runState === "healed"
                        ? "text-[var(--icon-warning-base)]"
                        : props.runState === "passed"
                          ? "text-[var(--icon-success-base)]"
                          : "text-[var(--text-interactive-base)]",
                  )}
                >
                  <i class="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  <span>{props.runState}</span>
                </div>
              </Show>
            </div>
          </section>

          <Show when={scrollSurface.captureProps()}>
            {(capture) => (
              <section class="grid gap-1.5 border-t border-[var(--border-weak-base)] px-3 py-2.5">
                <Show when={(capture().variants?.length ?? 0) > 1}>
                  <label
                    for="scroll-surface-variant"
                    class="text-[9.5px] font-medium text-[var(--text-base)]"
                  >
                    Screen variant
                  </label>
                  <select
                    id="scroll-surface-variant"
                    class="min-h-11 w-full rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-[10.5px] text-[var(--text-strong)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                    value={capture().selectedVariantId}
                    disabled={capture().busy}
                    onChange={(event) => capture().onSelectVariant?.(event.currentTarget.value)}
                  >
                    <For each={capture().variants}>
                      {(variant) => <option value={variant.id}>{variant.label}</option>}
                    </For>
                  </select>
                </Show>
                <p class="m-0 text-[9.5px]/[1.4] text-[var(--text-weak)]">
                  {capture().policy?.reason ??
                    "Viewport only by default. Opt into a full surface for stable product UI."}
                </p>
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3 text-[10.5px] font-medium text-[var(--text-strong)] outline-none transition-[background-color,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.99] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
                  disabled={capture().busy || Boolean(capture().disabledReason)}
                  aria-describedby={
                    capture().disabledReason || capture().error
                      ? "scroll-surface-capture-status"
                      : undefined
                  }
                  onClick={capture().onCapture}
                >
                  <Icon name={capture().busy ? "refresh" : "camera"} size={12} />
                  <span>{capture().busy ? "Capturing full surface…" : "Capture full surface"}</span>
                </button>
                <Show when={capture().disabledReason || capture().error}>
                  <p
                    id="scroll-surface-capture-status"
                    role={capture().error ? "alert" : undefined}
                    class={cn(
                      "m-0 text-[9.5px]/[1.4]",
                      capture().error
                        ? "text-[var(--icon-critical-base)]"
                        : "text-[var(--text-weak)]",
                    )}
                  >
                    {capture().error || capture().disabledReason}
                  </p>
                </Show>
              </section>
            )}
          </Show>

          <Show when={scrollSurface.surface()}>
            <LogicalScrollSurfaceViewer
              surface={scrollSurface.surface()!}
              evidenceUrl={scrollSurface.evidenceUrl}
            />
          </Show>

          <Show when={props.flowSetup}>
            {(flowSetup) => (
              <section class="grid gap-1.5 border-t border-[var(--border-weak-base)] px-3 py-2.5">
                <div class="flex items-baseline justify-between gap-3">
                  <label
                    for="screen-flow-setup"
                    class="text-[10.5px] font-medium text-[var(--text-base)]"
                  >
                    When a run starts
                  </label>
                </div>
                <select
                  id="screen-flow-setup"
                  class="h-9 w-full rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-[11px] text-[var(--text-strong)] outline-none transition-colors hover:border-[var(--border-strong-base)] focus-visible:border-[var(--border-focus)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--border-focus)_24%,transparent)]"
                  value={flowSetup().mixed ? "__mixed__" : (flowSetup().routineId ?? "")}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== "__mixed__") props.onFlowSetup(value || undefined);
                  }}
                >
                  <Show when={flowSetup().mixed}>
                    <option value="__mixed__" disabled>
                      Mixed setup
                    </option>
                  </Show>
                  <option value="">Check this screen is open</option>
                  <For each={flowSetup().routines}>
                    {(routine) => <option value={routine.id}>{routine.name}</option>}
                  </For>
                </select>
              </section>
            )}
          </Show>

          <section class="grid gap-1 border-t border-[var(--border-weak-base)] px-2 py-2">
            <div class="flex min-h-6 items-center justify-between gap-3 px-1">
              <span class="text-[10.5px] font-medium text-[var(--text-base)]">Paths</span>
              <span class="font-mono text-[9.5px] tabular-nums text-[var(--text-weak)]">
                {props.connections.length}
              </span>
            </div>
            <Show
              when={props.connections.length}
              fallback={
                <p class="m-0 rounded-[8px] bg-[var(--surface-base)] px-2.5 py-2 text-[10.5px]/[1.45] text-[var(--text-weak)]">
                  No paths from this screen.
                </p>
              }
            >
              <For each={props.connections}>
                {(connection) => {
                  const targetTitle = () => props.titleForScreen(connection.toScreenId);
                  return (
                    <button
                      type="button"
                      class="flex min-h-10 items-center gap-2 rounded-[8px] px-2 text-left text-[11px] text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.99] motion-reduce:active:scale-100"
                      aria-label={`Open path to ${targetTitle()}`}
                      onClick={() => props.onSelectConnection(connection)}
                    >
                      <span
                        class={cn(
                          "grid size-5 shrink-0 place-items-center rounded-[5px]",
                          connection.state === "needs-recording"
                            ? "bg-[color-mix(in_srgb,var(--icon-warning-base)_16%,transparent)] text-[var(--icon-warning-base)]"
                            : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                        )}
                      >
                        <Icon
                          name={connection.state === "needs-recording" ? "clock" : "arrow-right"}
                          size={10}
                        />
                      </span>
                      <span class="min-w-0 flex-1 truncate">{targetTitle()}</span>
                      <Icon name="arrow-right" size={11} class="text-[var(--text-weak)]" />
                    </button>
                  );
                }}
              </For>
            </Show>
          </section>

          <footer class="border-t border-[var(--border-weak-base)] p-2">
            <button
              type="button"
              class="flex min-h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[10.5px] text-[var(--text-base)] transition-colors hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_9%,transparent)] hover:text-[var(--icon-critical-base)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--icon-critical-base)]"
              aria-label="Remove screen"
              data-tip="Remove screen · Delete"
              onClick={props.onRemove}
            >
              <Icon name="trash" size={12} />
              <span>Delete screen</span>
            </button>
          </footer>
        </aside>
      )}
    </Show>
  );
}

/**
 * Groups are visual organization only, but they still need a discoverable
 * selection state. This keeps the canvas honest: selecting a section gives
 * the user useful context without pretending the group is executable.
 */
export function GroupInspector(props: {
  group: MapGroup | null;
  screens: Array<{ id: string; title: string }>;
  onSelectScreen: (screenId: string) => void;
  onRename: () => void;
  onUngroup: () => void;
  onClose: () => void;
}) {
  return (
    <Show when={props.group}>
      {(group) => (
        <aside
          data-app-map-group-inspector
          class="app-map-panel-scroll absolute top-16 right-3 z-30 max-h-[calc(100%-144px)] w-[min(304px,calc(100%-24px))] touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain rounded-[13px] border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--background-base)_97%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[14px] max-[720px]:top-auto max-[720px]:right-3 max-[720px]:bottom-[calc(72px+env(safe-area-inset-bottom))] max-[720px]:left-3 max-[720px]:max-h-[min(70%,540px)] max-[720px]:w-auto"
          aria-label={`Details for group ${group().name}`}
          data-app-map-native-scroll
          onWheel={(event) => event.stopPropagation()}
        >
          <header class="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--border-weak-base)] px-2.5">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                <Icon name="group" size={12} />
              </span>
              <div class="min-w-0">
                <span class="block text-[10px] font-medium text-[var(--text-weak)]">Group</span>
                <strong class="mt-0.5 block truncate text-[12px] font-semibold text-[var(--text-strong)]">
                  {group().name}
                </strong>
              </div>
            </div>
            <div class="flex items-center">
              <button
                type="button"
                class="relative grid size-9 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-1 transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100"
                aria-label={`Rename ${group().name}`}
                title="Rename group · F2"
                onClick={props.onRename}
              >
                <Icon name="edit" size={12} />
              </button>
              <button
                type="button"
                class="relative grid size-9 place-items-center rounded-[8px] text-[var(--text-weak)] before:absolute before:-inset-1 transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100"
                aria-label="Close group details"
                onClick={props.onClose}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </header>
          <p class="m-0 px-3 py-2.5 text-[10.5px]/[1.45] text-[var(--text-weak)]">
            {props.screens.length} {props.screens.length === 1 ? "screen" : "screens"}. Groups only
            organize the canvas; they do not affect runs.
          </p>
          <div class="border-t border-[var(--border-weak-base)] px-2 py-2">
            <span class="block px-1 pb-1 text-[9.5px] font-medium text-[var(--text-weak)]">
              Screens
            </span>
            <div class="grid gap-0.5">
              <For each={props.screens}>
                {(screen) => (
                  <button
                    type="button"
                    class="flex min-h-10 items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
                    onClick={() => props.onSelectScreen(screen.id)}
                  >
                    <span class="grid size-5 shrink-0 place-items-center rounded-[5px] bg-[var(--surface-base-hover)] text-[var(--text-weak)]">
                      <Icon name="smartphone" size={10} />
                    </span>
                    <span class="min-w-0 flex-1 truncate">{screen.title}</span>
                    <Icon name="arrow-right" size={11} class="text-[var(--text-weak)]" />
                  </button>
                )}
              </For>
            </div>
          </div>
          <footer class="border-t border-[var(--border-weak-base)] p-2">
            <button
              type="button"
              class="flex min-h-10 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[10.5px] text-[var(--text-base)] transition-colors hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
              onClick={props.onUngroup}
            >
              <Icon name="group" size={12} class="text-[var(--text-weak)]" />
              <span>Ungroup screens</span>
              <kbd class="ml-auto text-[10px] text-[var(--text-weak)]">⇧⌘G</kbd>
            </button>
          </footer>
        </aside>
      )}
    </Show>
  );
}
