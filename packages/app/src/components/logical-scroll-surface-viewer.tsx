import { For, Show } from "solid-js";
import { panelSectionLabel } from "../lib/ui";
import type { LogicalScrollSurface } from "@relay/protocol";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

/** Presents a scroll capture as one logical screen. The stitched image is the
 * default view; immutable source viewports remain inspectable as evidence. */
export function LogicalScrollSurfaceViewer(props: {
  surface: LogicalScrollSurface;
  evidenceUrl: (uri: string, mime: "image/png" | "application/json") => string;
  regenerating?: boolean;
  onRegenerate?: () => void;
}) {
  const legacyClassification = () => {
    if (props.surface.status === "completed" && props.surface.reason === "end-of-content") {
      return "complete" as const;
    }
    if (
      ["inspection-unavailable", "missing-page-anchor", "dimension-changed"].includes(
        props.surface.reason,
      )
    ) {
      return "unsupported" as const;
    }
    if (
      props.surface.reason === "seam-ambiguous" &&
      (props.surface.diagnosticViewports?.length ?? 0) > 0
    ) {
      return "dynamic" as const;
    }
    return "partial" as const;
  };
  const classification = () =>
    props.surface.confidenceModel?.classification ?? legacyClassification();
  const complete = () => classification() === "complete";
  const confidence = () => props.surface.confidenceModel?.confidence;
  const capturedPixels = () =>
    props.surface.confidenceModel?.capturedPixels ??
    props.surface.composite?.height ??
    Math.max(...props.surface.viewports.map((viewport) => viewport.offsetY + viewport.height));
  const statusLabel = () =>
    ({ complete: "Complete", partial: "Partial", dynamic: "Dynamic", unsupported: "Unsupported" })[
      classification()
    ];
  const statusTone = () =>
    classification() === "complete"
      ? "bg-[color-mix(in_srgb,var(--icon-success-base)_13%,transparent)] text-[var(--icon-success-base)]"
      : classification() === "unsupported"
        ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_12%,transparent)] text-[var(--icon-critical-base)]"
        : "bg-[color-mix(in_srgb,var(--icon-warning-base)_13%,transparent)] text-[var(--icon-warning-base)]";
  const viewportLabel = () =>
    `${props.surface.viewports.length} source viewport${props.surface.viewports.length === 1 ? "" : "s"}`;

  return (
    <section
      class="grid gap-3 border-t border-[var(--border-weak-base)] px-3 py-3"
      aria-label="Full page evidence"
      data-logical-scroll-surface
    >
      <header class="flex items-start gap-2.5">
        <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
          <Icon name="grid" size={12} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="m-0 truncate text-caption font-semibold text-[var(--text-strong)]">
              Full page
            </h3>
            <span
              class={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium",
                statusTone(),
              )}
            >
              <i class="size-1 rounded-full bg-current" aria-hidden="true" />
              {statusLabel()}
            </span>
          </div>
          <p class="m-0 mt-0.5 text-micro/[1.4] text-[var(--text-weak)]">
            One mapped screen · {viewportLabel()}
          </p>
        </div>
      </header>

      <div class="grid gap-1.5 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-2.5">
        <div class="flex items-center justify-between gap-3 text-micro/[1.35]">
          <span class="font-medium text-[var(--text-base)]">
            {capturedPixels().toLocaleString()} px captured
          </span>
          <Show when={confidence() !== undefined}>
            <span class="font-mono tabular-nums text-[var(--text-weak)]">
              {Math.round(confidence()! * 100)}% surface confidence
            </span>
          </Show>
        </div>
        <div
          class="flex h-2 overflow-hidden rounded-full bg-[var(--background-deep)]"
          role="img"
          aria-label={
            complete()
              ? `${capturedPixels().toLocaleString()} pixels captured; document end reached`
              : `${capturedPixels().toLocaleString()} pixels captured; document end unknown; coverage continues beyond the captured evidence`
          }
          data-scroll-surface-coverage
        >
          <span
            class={cn(
              "h-full shrink-0",
              complete()
                ? "w-full bg-[var(--text-interactive-base)]"
                : classification() === "dynamic"
                  ? "w-2 bg-[var(--icon-warning-base)]"
                  : "w-2 bg-[var(--text-interactive-base)]",
            )}
            aria-hidden="true"
            data-scroll-surface-captured
          />
          <Show when={!complete()}>
            <span
              class="h-full min-w-6 flex-1 border-l border-dashed border-[var(--border-strong-base)] bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_srgb,var(--text-weaker)_18%,transparent)_4px_6px)]"
              aria-hidden="true"
              data-scroll-surface-not-reached
            />
          </Show>
        </div>
        <div class="flex items-center justify-between gap-3 text-micro/[1.35] text-[var(--text-weaker)]">
          <span>Captured from immutable viewports</span>
          <span>{complete() ? "Document end reached" : "Document end unknown"}</span>
        </div>
      </div>

      <Show when={props.surface.confidenceModel}>
        {(model) => (
          <div class="flex flex-wrap gap-1.5 text-micro text-[var(--text-weak)]">
            <Show when={model().mergeAnchors.length > 0}>
              <span class="rounded-md bg-[var(--surface-base)] px-1.5 py-1">
                {model().mergeAnchors.length} merge anchor
                {model().mergeAnchors.length === 1 ? "" : "s"}
              </span>
            </Show>
            <Show when={model().regions.some((region) => region.kind === "sticky")}>
              <span class="rounded-md bg-[var(--surface-base)] px-1.5 py-1">
                {model().regions.filter((region) => region.kind === "sticky").length} sticky
                {model().regions.filter((region) => region.kind === "sticky").length === 1
                  ? " region"
                  : " regions"}
              </span>
            </Show>
            <Show when={model().regions.some((region) => region.kind === "dynamic")}>
              <span class="rounded-md bg-[var(--surface-base)] px-1.5 py-1">
                Dynamic region retained for review
              </span>
            </Show>
            <Show when={model().scrollContainer}>
              {(container) => (
                <span class="rounded-md bg-[var(--surface-base)] px-1.5 py-1">
                  {container().nested ? "Nested" : "Primary"} scroll container identified
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={props.surface.composite}
        fallback={
          <div class="grid min-h-28 place-items-center rounded-xl border border-dashed border-[var(--border-strong-base)] bg-[var(--background-deep)] px-4 text-center">
            <div class="grid justify-items-center gap-1.5">
              <Icon name="camera" size={16} class="text-[var(--text-weaker)]" />
              <strong class={panelSectionLabel}>Preview unavailable</strong>
              <span class="max-w-[26ch] text-micro/[1.4] text-[var(--text-weak)]">
                The source viewports below are intact and can regenerate it.
              </span>
            </div>
          </div>
        }
      >
        {(composite) => (
          <div
            class="relative max-h-[420px] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-weak-base)] bg-[var(--background-deep)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background-base)_35%,transparent)]"
            data-scroll-surface-composite
          >
            <div class="relative mx-auto w-full">
              <img
                src={props.evidenceUrl(composite().uri, "image/png")}
                alt="Full scrollable screen"
                class="block h-auto w-full"
                width={composite().width}
                height={composite().height}
              />
              <For each={props.surface.viewports.slice(1)}>
                {(viewport) => (
                  <span
                    class="pointer-events-none absolute right-0 left-0 border-t border-dashed border-[color-mix(in_srgb,var(--text-interactive-base)_55%,transparent)]"
                    style={{ top: `${(viewport.offsetY / composite().height) * 100}%` }}
                    aria-hidden="true"
                    data-scroll-surface-boundary={viewport.index}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <div class="flex items-center justify-between gap-2">
        <p class="m-0 min-w-0 text-micro/[1.35] text-[var(--text-weaker)]">
          Built from lossless source evidence.
        </p>
        <Show when={props.onRegenerate}>
          <button
            type="button"
            class="inline-flex min-h-10 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-micro font-medium text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.96] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
            disabled={props.regenerating}
            aria-busy={props.regenerating}
            onClick={props.onRegenerate}
          >
            <Icon
              name="refresh"
              size={11}
              class={props.regenerating ? "animate-spin motion-reduce:animate-none" : undefined}
            />
            {props.regenerating ? "Regenerating…" : "Regenerate preview"}
          </button>
        </Show>
      </div>

      <details
        class="group overflow-hidden rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)]"
        open={!props.surface.composite}
        data-scroll-surface-evidence
      >
        <summary class="flex min-h-11 touch-manipulation cursor-pointer list-none items-center gap-2 px-2.5 text-micro font-medium text-[var(--text-base)] outline-none marker:content-none hover:bg-[var(--surface-base-hover)] focus-visible:ring-2 focus-visible:-ring-offset-2 focus-visible:ring-[var(--border-focus)] [&::-webkit-details-marker]:hidden">
          <Icon name="grid" size={11} class="text-[var(--text-weak)]" />
          <span class="min-w-0 flex-1">Source viewports and trees</span>
          <span class="font-mono text-micro tabular-nums text-[var(--text-weak)]">
            {props.surface.viewports.length}
          </span>
          <Icon
            name="chevron-right"
            size={11}
            class="text-[var(--text-weaker)] transition-transform duration-hover group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <div class="grid gap-2.5 border-t border-[var(--border-weak-base)] p-2.5">
          <p class="m-0 text-micro/[1.4] text-[var(--text-weak)]">
            These exact captures and accessibility trees are the canonical evidence. They can always
            rebuild the preview above.
          </p>
          <ol
            class="app-map-panel-scroll m-0 flex list-none gap-2 overflow-x-auto overscroll-x-contain p-0 pb-1"
            data-scroll-surface-viewports
          >
            <For each={props.surface.viewports}>
              {(viewport) => (
                <li class="grid w-[176px] shrink-0 gap-1.5 rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-deep)] p-1.5">
                  <div class="flex items-center justify-between gap-2 px-0.5 text-micro text-[var(--text-weak)]">
                    <strong class="font-medium text-[var(--text-base)]">
                      Viewport {viewport.index + 1}
                    </strong>
                    <span class="font-mono tabular-nums">y {viewport.offsetY}</span>
                  </div>
                  <img
                    src={props.evidenceUrl(viewport.screenshot.uri, "image/png")}
                    alt={`Source viewport ${viewport.index + 1}`}
                    class="block h-[188px] w-full rounded-md object-contain object-top"
                    width={viewport.width}
                    height={viewport.height}
                    loading="lazy"
                  />
                  <a
                    href={props.evidenceUrl(viewport.accessibilityTree.uri, "application/json")}
                    target="_blank"
                    rel="noreferrer"
                    class="flex min-h-10 touch-manipulation items-center rounded-md px-1.5 text-micro font-medium text-[var(--text-interactive-base)] outline-none hover:bg-[var(--surface-base-hover)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                  >
                    Accessibility tree
                  </a>
                </li>
              )}
            </For>
          </ol>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-micro">
            <a
              href={props.evidenceUrl(props.surface.mergedTree.uri, "application/json")}
              target="_blank"
              rel="noreferrer"
              class="min-h-10 touch-manipulation content-center font-medium text-[var(--text-interactive-base)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              Merged tree · {props.surface.mergedTree.nodeCount} nodes
            </a>
            <a
              href={props.evidenceUrl(props.surface.manifest.uri, "application/json")}
              target="_blank"
              rel="noreferrer"
              class="min-h-10 touch-manipulation content-center font-medium text-[var(--text-interactive-base)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              Capture manifest
            </a>
          </div>
          <Show when={!complete()}>
            <p class="m-0 rounded-lg bg-[color-mix(in_srgb,var(--icon-warning-base)_10%,transparent)] px-2 py-1.5 text-micro/[1.4] text-[var(--text-base)]">
              Capture stopped: {props.surface.reason.replaceAll("-", " ")}. {props.surface.message}
            </p>
          </Show>
        </div>
      </details>
    </section>
  );
}
