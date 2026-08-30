import { Show, Suspense, createEffect } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { WorkspaceSkeleton } from "./workspace-skeleton";
import { AppMapCombine } from "./studio-shell-workspaces";

/**
 * Presentation for the Combine side rail. The editor stays mounted while the
 * device companion is open so drafted rows survive; the rail just collapses.
 */
export function StudioShellCombineRail(props: {
  combineId?: string;
  focusSection?: CanvasCombineSection;
  collapsed: boolean;
  onOpenDevice: () => void;
  onExpand: () => void;
  onClose: () => void;
  onOpenRun: (runId?: string) => void;
}) {
  let reopenControl: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  let wasCollapsed = props.collapsed;

  createEffect(() => {
    const collapsed = props.collapsed;
    if (collapsed && !wasCollapsed) {
      queueMicrotask(() => reopenControl?.focus({ preventScroll: true }));
    }
    wasCollapsed = collapsed;
  });

  function expand(): void {
    props.onExpand();
    queueMicrotask(() => {
      panel
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus({ preventScroll: true });
    });
  }

  return (
    <aside
      class={cn(
        "relative z-[6] flex min-h-0 shrink-0 overflow-hidden border-l border-[var(--border-strong-base)] bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[-12px_0_32px_rgb(0_0_0/10%)] max-[760px]:absolute max-[760px]:inset-y-2 max-[760px]:right-2 max-[760px]:rounded-2xl max-[760px]:border",
        props.collapsed
          ? "w-[44px] max-[760px]:w-[44px]"
          : "w-[clamp(420px,40vw,560px)] max-[760px]:w-[min(560px,calc(100%-16px))]",
      )}
      aria-label="Repeat"
      onWheel={(event) => event.stopPropagation()}
    >
      <Show when={props.collapsed}>
        <button
          ref={(element) => (reopenControl = element)}
          type="button"
          class="relative z-[1] flex min-h-11 w-11 flex-1 flex-col items-center justify-start gap-2 py-3 text-text-base transition-colors hover:bg-surface-base-hover hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-strong-focus"
          aria-label="Open Repeat"
          data-tip="Open Repeat"
          onClick={expand}
        >
          <Icon name="chevron-left" size={15} />
          <span
            class="text-micro font-semibold tracking-[0.1em] uppercase [writing-mode:vertical-rl]"
            aria-hidden="true"
          >
            Repeat
          </span>
        </button>
      </Show>
      <div
        ref={(element) => (panel = element)}
        class={cn(
          "flex min-h-0 min-w-0 flex-1",
          props.collapsed && "pointer-events-none invisible absolute inset-0",
        )}
        aria-hidden={props.collapsed || undefined}
        inert={props.collapsed}
        data-combine-panel
      >
        <Suspense fallback={<WorkspaceSkeleton label="combine" />}>
          <AppMapCombine
            combineId={props.combineId}
            focusSection={props.focusSection}
            collapsed={props.collapsed}
            onOpenRun={props.onOpenRun}
            onOpenDevice={props.onOpenDevice}
            onClose={props.onClose}
          />
        </Suspense>
      </div>
    </aside>
  );
}
