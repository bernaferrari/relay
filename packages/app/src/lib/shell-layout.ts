/**
 * Product shell layout as Tailwind recipes.
 * Prefer these over product BEM CSS. Theme tokens come from @relay/ui.
 */
import { cn } from "./cn";

/**
 * Root app grid: navigator | main.
 * The navigator track collapses via the --shell-nav var, which the shell sets
 * with an INLINE STYLE (`shellRootNavVar`) — never via competing utility
 * classes: cn() does not merge, and two classes setting the same property
 * resolve by stylesheet order, not class-list order.
 */
export const shellRoot = cn(
  "grid h-full w-full min-h-0 overflow-hidden text-[var(--text-strong)] bg-[var(--v2-background-bg-deep)] isolation-isolate",
  "grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]",
);

/** Inline-style value for the root: pass to `style` so it always wins. */
export function shellRootNavVar(open: boolean): Record<string, string> {
  return { "--shell-nav": open ? "var(--shell-nav-width)" : "0px" };
}

/**
 * The single navigator: areas, App Maps, and the open Flow's actions. It
 * replaces the old 58px rail + library + outline triple. Keeping one panel
 * means one selection model and one place to look for anything nameable.
 */
export const shellNav = cn(
  "fixed top-0 bottom-0 left-0 z-[80] flex min-h-0 w-[var(--shell-nav-width)] flex-col overflow-hidden",
  "border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
  "shadow-[18px_0_56px_rgb(0_0_0/32%)] transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.65,0,0.35,1)]",
  "will-change-transform",
  // Inner content keeps its width during the collapse so text does not reflow.
  "[&>*]:w-[var(--shell-nav-width)]",
);

export const shellNavClosed =
  "pointer-events-none -translate-x-3.5 opacity-0 border-r-0 max-[900px]:-translate-x-full";

export const shellMain =
  "col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col bg-[var(--v2-background-bg-deep)]";

export const shellTopbar = cn(
  "shell-drag relative z-[70] flex min-h-[54px] shrink-0 items-center justify-between gap-4 overflow-visible border-b border-[var(--v2-border-border-muted)]",
  "bg-[color-mix(in_srgb,var(--v2-background-bg-base)_78%,var(--v2-background-bg-deep))] px-4",
);

export const shellTopbarContext = "flex min-w-0 flex-1 items-center gap-2";
export const shellTopbarTitle =
  "pointer-events-auto absolute left-1/2 top-1/2 flex max-w-[min(42vw,420px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center max-[680px]:max-w-[34vw]";
export const shellTopbarActions = "flex shrink-0 items-center gap-2.5 max-[680px]:gap-1";

export const shellBreadcrumb = cn(
  "flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-weak)]",
  "[&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap",
  "[&_strong]:font-medium [&_strong]:text-[var(--text-base)]",
);

export const shellStudio = "relative z-0 flex min-h-0 min-w-0 flex-1 flex-col";

export const shellViewTabs = "flex items-center gap-1";

export const shellViewTab = cn(
  "inline-flex min-h-[30px] items-center gap-[7px] rounded-lg px-2.5",
  "text-[12px] font-medium text-[var(--text-weak)] transition-colors",
  "hover:enabled:bg-[var(--v2-background-bg-layer-01)] hover:enabled:text-[var(--text-strong)]",
  "disabled:cursor-not-allowed disabled:opacity-40",
);

export const shellViewTabActive = cn(
  "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)]",
  "shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]",
);

export const shellSaveState = "mr-1.5 text-[11px] text-[var(--text-weak)]";

export const shellStudioBody = cn(
  "grid min-h-0 min-w-0 flex-1",
  "grid-cols-[minmax(360px,1fr)_clamp(350px,34vw,480px)]",
  "max-[1120px]:min-[901px]:grid-cols-[minmax(320px,1fr)_clamp(320px,38vw,410px)]",
  "max-[900px]:grid-cols-[minmax(280px,1fr)_minmax(320px,42vw)]",
);

/**
 * The focused workbench cannot be composed with `shellStudioBody`: both recipes set
 * grid-template-columns, and utility stylesheet order would decide which one
 * wins. Keep this as a complete grid recipe and select it directly.
 *
 * Two tracks, not three — the step outline lives in the navigator now, so the
 * body is exactly the device and the properties for the selected step.
 */
export const shellStudioBodyWorkbench = cn(
  "grid min-h-0 min-w-0 flex-1",
  "grid-cols-[minmax(420px,1fr)_336px]",
  "max-[1380px]:min-[901px]:grid-cols-[minmax(360px,1fr)_312px]",
  "max-[900px]:grid-cols-1",
);

export const shellStudioBodyMap = "block overflow-hidden";

/**
 * Below 900px the right-hand panel floats over the stage as a drawer. The
 * stage must reserve that width, or the drawer hides the stage's own actions
 * (e.g. the device card's Start/Choose buttons).
 */
export const shellStageDrawerClearance = "max-[900px]:pr-[min(340px,calc(100vw-64px))]";

/** Right-hand panel behavior below 900px — one drawer treatment for all. */
export const shellAsideDrawer = cn(
  "max-[900px]:absolute max-[900px]:right-0 max-[900px]:bottom-0 max-[900px]:z-[6]",
  "max-[900px]:h-[calc(100%-104px)] max-[900px]:w-[min(340px,calc(100vw-64px))]",
  "max-[900px]:shadow-[-20px_0_50px_rgb(0_0_0/35%)]",
);

export const shellStageWrap = cn(
  "relative min-h-0 min-w-0 overflow-hidden",
  "bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_94%,var(--v2-background-bg-accent))]",
  "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:content-['']",
  "before:bg-[radial-gradient(circle_at_50%_34%,rgb(139_124_255/7%),transparent_48%)]",
  "[&>*]:relative [&>*]:z-[1]",
);

export const shellSteps = cn(
  "flex min-h-0 min-w-0 flex-col border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
);

export const shellStepsBody = "min-h-0 min-w-0 flex-1 overflow-hidden";

export const shellHealth =
  "inline-block size-1.5 shrink-0 rounded-full bg-[var(--icon-critical-base)]";
export const shellHealthOnline = "bg-[var(--icon-success-base)]";

export const shellDragStrip =
  "shell-drag-strip pointer-events-none fixed top-0 right-0 left-[var(--traffic-pad,0px)] z-[100] hidden h-3";
