/**
 * Product shell layout as Tailwind recipes.
 * Prefer these over product BEM CSS. Theme tokens come from @relay/ui.
 */
import { cn } from "./cn";

/**
 * Root app grid: rail | library | main.
 * The library track collapses via the --shell-lib var, which the shell sets
 * with an INLINE STYLE (`shellRootLibraryVar`) — never via competing utility
 * classes: cn() does not merge, and two classes setting the same property
 * resolve by stylesheet order, not class-list order.
 */
export const shellRoot = cn(
  "grid h-full w-full min-h-0 overflow-hidden text-[var(--text-strong)] bg-[var(--v2-background-bg-deep)] isolation-isolate",
  "grid-cols-[58px_var(--shell-lib,var(--shell-library-width))_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]",
  "max-[900px]:grid-cols-[58px_0_minmax(0,1fr)]",
  "transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.65,0,0.35,1)]",
);

/** Inline-style value for the root: pass to `style` so it always wins. */
export function shellRootLibraryVar(open: boolean): Record<string, string> {
  return { "--shell-lib": open ? "var(--shell-library-width)" : "0px" };
}

export const shellRail = cn(
  "relative z-[3] col-start-1 row-start-1 flex min-h-0 flex-col items-center gap-4 border-r border-[var(--v2-border-border-muted)]",
  "bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_97%,black)] px-1.5 pt-[var(--rail-top-pad,14px)] pb-2.5",
);

/** Brand mark — the one place a flat brand color is allowed to stand alone
 *  without matching app chrome tones (product logo, not a UI surface). */
export const shellMark = cn(
  "relative size-8 shrink-0 rounded-[10px] bg-[#6454e9] text-white",
  "active:scale-[0.97]",
);

export const shellRailNav = "flex w-full flex-1 flex-col gap-1.5";

export const shellRailItem = cn(
  "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg",
  "text-[10px] font-medium tracking-[0.01em] text-[var(--text-weak)]",
  "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
  "hover:bg-white/[0.06] hover:text-[var(--text-strong)]",
);

export const shellRailItemActive = cn(
  "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)]",
  "[&_svg]:text-[var(--text-interactive-base)]",
);

export const shellLibrary = cn(
  "relative z-[2] col-start-2 row-start-1 flex min-h-0 flex-col overflow-hidden",
  "border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
  "transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.65,0,0.35,1)]",
  "will-change-transform",
  "max-[900px]:fixed max-[900px]:top-0 max-[900px]:bottom-0 max-[900px]:left-[58px] max-[900px]:z-[60] max-[900px]:w-[var(--shell-library-width)] max-[900px]:shadow-[24px_0_60px_rgb(0_0_0/42%)]",
  // Inner content keeps its width during the collapse so text does not reflow.
  "[&>*]:w-[var(--shell-library-width)]",
);

export const shellLibraryClosed =
  "pointer-events-none -translate-x-3.5 opacity-0 border-r-0 max-[900px]:-translate-x-full";

export const shellMain =
  "col-start-3 row-start-1 flex min-h-0 min-w-0 flex-col bg-[var(--v2-background-bg-deep)]";

export const shellTopbar = cn(
  "shell-drag relative z-[70] flex min-h-[54px] shrink-0 items-center justify-between gap-4 overflow-visible border-b border-[var(--v2-border-border-muted)]",
  "bg-[rgb(9_11_16/94%)] px-4",
);

export const shellTopbarContext = "flex min-w-0 items-center gap-2";
export const shellTopbarActions = "flex items-center gap-2.5";

export const shellBreadcrumb = cn(
  "flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-weak)]",
  "[&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap",
  "[&_strong]:font-medium [&_strong]:text-[var(--text-base)]",
);

export const shellRecord = cn(
  "inline-flex min-h-[38px] items-center justify-center gap-[7px] rounded-[10px] px-3.5",
  "text-[13px] font-semibold text-white select-none",
  "border border-[#7e70ed] bg-[#705ff0] shadow-none",
  "transition-[color,background-color,box-shadow,transform] duration-150",
  "hover:enabled:bg-[#7d6df5] active:enabled:scale-[0.97]",
  "disabled:cursor-not-allowed disabled:bg-[var(--v2-background-bg-layer-01)] disabled:text-[var(--text-weak)]",
  "disabled:border-[var(--v2-border-border-muted)] disabled:shadow-none",
  "data-[blocked]:cursor-not-allowed data-[blocked]:bg-[var(--v2-background-bg-layer-01)] data-[blocked]:text-[var(--text-weak)]",
  "data-[blocked]:border-[var(--v2-border-border-strong)] data-[blocked]:shadow-none",
);

export const shellRecordDot = "size-[7px] shrink-0 rounded-full bg-current";

/** Recording creates a test; it should not compete with the primary Run action. */
export const shellCapture = cn(
  "inline-flex min-h-[36px] items-center justify-center gap-[7px] rounded-[9px] px-3",
  "text-[12.5px] font-semibold text-[var(--text-base)] select-none",
  "bg-[var(--v2-background-bg-layer-01)] shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]",
  "transition-[color,background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
  "hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97]",
  "disabled:cursor-not-allowed disabled:text-[var(--text-weak)]",
  "data-[blocked]:cursor-not-allowed data-[blocked]:text-[var(--text-weak)]",
);

export const shellCaptureActive = cn(
  "bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,var(--v2-background-bg-layer-01))] text-[var(--icon-critical-base)]",
  "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--icon-critical-base)_38%,transparent)]",
);

export const shellStudio = "relative z-0 flex min-h-0 min-w-0 flex-1 flex-col";

export const shellStudioBar = cn(
  "shell-drag flex min-h-11 shrink-0 items-center justify-between border-b border-[var(--v2-border-border-muted)] px-3.5",
  "bg-[color-mix(in_srgb,var(--v2-background-bg-base)_72%,var(--v2-background-bg-deep))]",
);

export const shellViewTabs = "flex items-center gap-1";

export const shellViewTab = cn(
  "inline-flex min-h-[30px] items-center gap-[7px] rounded-lg px-2.5",
  "text-[12px] font-medium text-[var(--text-weak)] transition-colors",
  "hover:enabled:bg-white/[0.06] hover:enabled:text-[var(--text-strong)]",
  "disabled:cursor-not-allowed disabled:opacity-40",
);

export const shellViewTabActive = cn(
  "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)]",
  "shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]",
);

export const shellCount = cn(
  "grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-white/[0.05]",
  "font-mono text-[9px] text-[var(--text-weak)]",
);

export const shellSaveState = "mr-1.5 text-[11px] text-[var(--text-weak)]";

export const shellStudioBody = cn(
  "grid min-h-0 min-w-0 flex-1",
  "grid-cols-[minmax(360px,1fr)_clamp(350px,34vw,480px)]",
  "max-[1120px]:min-[901px]:grid-cols-[minmax(320px,1fr)_clamp(320px,38vw,410px)]",
  "max-[900px]:grid-cols-[minmax(280px,1fr)_minmax(320px,42vw)]",
);

/**
 * Journey cannot be composed with `shellStudioBody`: both recipes set
 * grid-template-columns, and utility stylesheet order would decide which one
 * wins. Keep this as a complete grid recipe and select it directly.
 */
export const shellStudioBodyJourney = cn(
  "grid min-h-0 min-w-0 flex-1",
  "grid-cols-[252px_minmax(420px,1fr)_372px]",
  "max-[1380px]:min-[901px]:grid-cols-[238px_minmax(360px,1fr)_340px]",
  "max-[900px]:grid-cols-1",
);

export const shellStudioBodyMap = "block overflow-hidden";

export const shellStageWrap = cn(
  "relative min-h-0 min-w-0 overflow-hidden",
  "bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_91%,black)]",
  "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:content-['']",
  "before:bg-[radial-gradient(circle_at_50%_38%,rgb(139_124_255/10%),transparent_44%),radial-gradient(circle_at_1px_1px,rgb(255_255_255/3%)_1px,transparent_0)] before:bg-size-[auto,20px_20px]",
  "[&>*]:relative [&>*]:z-[1]",
);

export const shellSteps = cn(
  "flex min-h-0 min-w-0 flex-col border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
);

export const shellStepsHead =
  "relative shrink-0 border-b border-[var(--v2-border-border-muted)] px-[18px] pt-[18px] pb-3.5";

export const shellStepsBody = "min-h-0 min-w-0 flex-1 overflow-hidden";

export const shellHealth =
  "inline-block size-1.5 shrink-0 rounded-full bg-[var(--icon-critical-base)]";
export const shellHealthOnline = "bg-[var(--icon-success-base)]";

export const shellDragStrip =
  "shell-drag-strip pointer-events-none fixed top-0 right-0 left-[var(--traffic-pad,0px)] z-[100] hidden h-3";
