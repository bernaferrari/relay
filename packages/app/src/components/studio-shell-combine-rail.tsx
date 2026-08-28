import { Suspense } from "solid-js";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { cn } from "../lib/cn";
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
  onClose: () => void;
  onOpenRun: (runId?: string) => void;
}) {
  return (
    <aside
      class={cn(
        "relative z-[6] flex min-h-0 shrink-0 overflow-hidden border-l border-[var(--border-strong-base)] bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[-12px_0_32px_rgb(0_0_0/10%)] transition-[width] max-[760px]:absolute max-[760px]:inset-y-2 max-[760px]:right-2 max-[760px]:rounded-2xl max-[760px]:border",
        props.collapsed
          ? "w-[44px] max-[760px]:w-[44px]"
          : "w-[clamp(420px,40vw,560px)] max-[760px]:w-[min(560px,calc(100%-16px))]",
      )}
      aria-hidden={props.collapsed || undefined}
      aria-label="Combine"
      onWheel={(event) => event.stopPropagation()}
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
    </aside>
  );
}
