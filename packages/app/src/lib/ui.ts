/**
 * App chrome layout recipes — AgentBoard token discipline.
 *
 * RULES (do not break):
 * 1. Solid paper = bg-surface-raised-stronger-non-alpha | bg-background-stronger
 *    NEVER use bg-surface-raised-base as a solid panel (it is ~3% alpha wash).
 * 2. Alpha washes only for hover/active: surface-raised-base-hover, surface-base-active.
 * 3. Primary ink = text-text-strong. Actions/icons on rows = text-text-strong.
 *    text-text-weak / text-text-weaker only for true secondary meta.
 * 4. List selection = AB: hover:bg-surface-raised-base-hover + active:bg-surface-base-active.
 * 5. Text buttons come from @relay/ui/button. This file only keeps structural chrome recipes.
 * 6. Type = product scale: text-micro / text-caption / text-body / text-title / text-display.
 * 7. cn() does NOT merge — never stack exclusive color recipes.
 */
import { cn } from "./cn";

export const easeOut = "ease-[cubic-bezier(0.23,1,0.32,1)]";
export const easeHover = "ease-[cubic-bezier(0.25,0.1,0.25,1)]";

export const tColor = cn(
  "transition-[background-color,color,border-color,opacity,box-shadow]",
  "duration-150",
  easeHover,
);

/* ─── Type scale (product micro / caption / body / title) ─── */
export const type12 = "text-caption";
export const type12Med = "text-caption font-medium";
export const type14 = "text-body";
export const type14Med = "text-body font-medium";
export const type16Med = "text-title font-medium";

/** Primary label ink */
export const ink = "text-text-strong";
/** Secondary body */
export const inkBase = "text-text-base";
/** Meta / secondary */
export const inkMuted = "text-text-weak";
/** Tertiary / captions only */
export const inkFaint = "text-text-weaker";

export const textPrimary = ink;
export const textSecondary = inkBase;
export const textMuted = inkMuted;
export const textFaint = inkFaint;

/** Dense two-line labels used by list rows, inspectors, and settings. Keep
 * their rhythm independent from paragraph leading so title/subtitle pairs
 * read as one unit. */
export const copyStack = "flex min-w-0 flex-col gap-px";
export const copyTitle = "leading-[1.25] text-text-strong";
export const copyDescription = "leading-[1.35] text-text-weak";

/* ─── Surfaces ─── */
/** App chrome deep plate */
export const surfaceDeep = "bg-background-weak text-text-strong";
/** Solid white/dark paper panel */
export const paper = "bg-surface-raised-stronger-non-alpha text-text-strong";
export const surfacePanel = paper;
export const surfacePanelSoft = paper; // solid only — never alpha-as-paper
/** Panel header / footer chrome */
export const surfaceChrome =
  "border-b border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-strong";
export const borderSubtle = "border-border-weak-base";
export const dividerY = "h-4 w-px shrink-0 bg-border-weak-base";

/** AgentBoard list row — inset chip (rounded-md), quiet hover, active = base-active */
export const listRow = cn(
  "group/session relative w-full min-w-0 rounded-md transition-colors duration-100",
  "hover:bg-surface-raised-base-hover",
  "[&:has(:focus-visible)]:bg-surface-raised-base-hover",
);
export const listRowActive = "bg-surface-base-active";
export const listRowHoverOnly = "hover:bg-surface-raised-base-hover";

/** Menu / switcher option — same wash discipline as list rows */
export const menuOption = cn(
  "rounded-md transition-colors duration-100",
  "hover:bg-surface-raised-base-hover",
  "[&:has(:focus-visible)]:bg-surface-raised-base-hover",
);
export const menuOptionOn = "bg-surface-base-active text-text-strong";
/** Expanded (not selected) — AB: hover wash, not active */
export const listRowExpanded = "bg-surface-raised-base-hover";

/** Full-width / chrome bar control — color wash only, no scale */
export const btnBar = cn(
  "inline-flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5",
  "text-left text-caption font-medium text-text-strong select-none",
  "transition-[background-color,box-shadow,color,border-color] duration-150",
  easeOut,
  "disabled:cursor-not-allowed disabled:text-text-weak",
);

export const deviceTitle = "device-title";
export const deviceBody = "device-body";
export const deviceCaption = "device-caption";
export const deviceIconWell = "device-icon-well";
export const phoneBezel = "phone-bezel";
export const phoneScreen = "phone-screen";

/* ─── Segments / fields ─── */
export const seg = cn(
  "inline-flex h-8 items-center gap-0.5 rounded-lg bg-surface-base p-0.5 ring-1 ring-inset ring-border-weak-base",
);

export const segBtn = cn(
  "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-caption font-medium text-text-base select-none",
  tColor,
  "hover:bg-surface-raised-base-hover hover:text-text-strong",
);

export const segBtnOn = cn(
  "h-7 rounded-md px-2.5 text-caption font-medium text-text-strong select-none",
  "bg-surface-raised-stronger-non-alpha shadow-xs-border-base",
  tColor,
);

export const segBtnRec = cn(
  segBtnOn,
  "bg-surface-critical-weak text-icon-critical-base ring-border-critical-base/40",
);

/** Full-width segmented control for dense property inspectors. */
export const propertySeg = cn(
  "inline-flex h-8 w-full items-center rounded-lg bg-[var(--surface-base)] p-0.5",
  "ring-1 ring-inset ring-[var(--border-weak-base)]",
);

const propertySegBtnBase = cn(
  "inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded-md px-2",
  "text-micro font-medium text-[var(--text-weak)] select-none",
  "transition-[background-color,color,box-shadow,transform] duration-100 ease-out",
  "active:enabled:scale-[0.98]",
);

export const propertySegBtn = cn(
  propertySegBtnBase,
  "hover:enabled:bg-[var(--surface-base-hover)] hover:enabled:text-[var(--text-base)]",
);

export const propertySegBtnOn = cn(
  propertySegBtnBase,
  "bg-[var(--surface-raised-base)] text-[var(--text-strong)]",
  "shadow-[0_1px_3px_rgb(0_0_0/24%)] hover:enabled:bg-[var(--surface-raised-base)]",
);

export const mono = "font-mono tabular-nums";

export const fieldLabel = cn(
  "w-16 shrink-0 pt-[9px] text-caption leading-none font-normal text-text-base",
);

export const fieldInput = cn(
  "h-8 min-w-0 w-full rounded-md bg-surface-raised-stronger-non-alpha px-2.5",
  "text-caption font-normal text-text-strong ring-1 ring-inset ring-border-weak-base",
  "placeholder:text-text-weak",
  "transition-[box-shadow] duration-150",
  "focus:outline-none focus:ring-2 focus:ring-border-interactive-base/45",
);

export const propRow = "grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-2 gap-y-1";

export const popover = cn(
  "ui-pop z-50 overflow-hidden rounded-lg",
  "bg-surface-raised-stronger-non-alpha p-1 text-text-strong shadow-md",
);

export const modalPanel = cn(
  "ui-modal overflow-hidden rounded-xl",
  "bg-surface-raised-stronger-non-alpha text-text-strong shadow-lg-border-base",
);

export const modalScrim = "ui-scrim fixed inset-0 z-[90]";

const stepIndexShell = cn(
  mono,
  "grid size-[26px] shrink-0 place-items-center rounded-lg",
  "text-caption font-medium leading-none tabular-nums",
);

export const stepIndex = cn(
  stepIndexShell,
  "bg-surface-raised-base text-text-strong ring-1 ring-inset ring-border-weak-base",
);

/** Selected index — button-primary + icon-invert (AB primary) */
export const stepIndexOn = cn(
  stepIndexShell,
  "bg-surface-brand-base text-text-on-brand-base ring-1 ring-inset ring-border-interactive-base",
);

export const kindPill = cn(
  "inline-flex shrink-0 items-center rounded-full px-1.5 py-px",
  "text-caption font-medium tracking-wide text-text-base",
  "bg-surface-base ring-1 ring-inset ring-border-weak-base",
);

/* ─── Product chrome (studio / pages) — prefer these over .relay-* CSS ─── */

/** Uppercase section label used across shell surfaces */
export const eyebrow = cn(
  "block text-caption/[1.2] font-semibold tracking-[0.09em] text-text-weak uppercase",
);

/**
 * One underline-tab grammar for every secondary tab strip in the product
 * (Steps/Inputs/YAML, the run report's Timeline/Overview/Checks/...). Pair
 * with `tabUnderlineActive` on the selected tab.
 */
export const tabUnderline = cn(
  "relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5",
  "text-body/[1.25] font-semibold text-text-weaker transition-colors",
  "after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:scale-x-0",
  "after:rounded-full after:bg-surface-brand-base after:transition-transform",
  "hover:enabled:bg-surface-raised-base-hover hover:enabled:text-text-weak focus-visible:outline-1 focus-visible:outline-border-strong-focus",
);

export const tabUnderlineActive = "text-text-strong after:scale-x-100";

/** Compact 36×36 chrome icon with a 44×44 effective pointer target. */
export const productIconButton = cn(
  "relative inline-grid size-9 shrink-0 place-items-center rounded-xl text-text-base select-none before:absolute before:-inset-1 before:content-['']",
  "transition-[color,background-color,transform] duration-150",
  "hover:enabled:bg-surface-base-hover hover:enabled:text-text-strong",
  "active:enabled:scale-[0.97]",
  "disabled:cursor-not-allowed disabled:opacity-35",
);

export const productIconButtonSolid = cn(
  productIconButton,
  "bg-surface-raised-strong text-text-strong shadow-[inset_0_0_0_1px_var(--border-weak-hover)]",
);

export const productIconButtonDanger = cn(
  productIconButton,
  "hover:enabled:text-icon-critical-base",
);

/** Scrollable product page (data / runs / settings-style surfaces) */
export const productPage = cn(
  "min-h-0 flex-1 overflow-y-auto bg-background-weak",
  "pt-8 pb-14 px-[clamp(1.5rem,4vw,3.5rem)]",
);

export const productPageHero = cn(
  "mx-auto mb-8 flex max-w-[1180px] items-start justify-between gap-6",
);

export const productPageTitle = cn(
  "m-0 text-display font-semibold leading-[1.12] tracking-[-0.035em] text-balance text-text-strong",
);

export const productPageLead = cn("m-0 max-w-[720px] text-body/[1.45] text-text-base");

/* Colorless base — tones append exactly one text- and one bg- pair (cn never merges). */
const statusBase = cn(
  "inline-flex w-fit min-h-[22px] items-center gap-1 rounded-md px-2",
  "text-caption font-semibold ring-1 ring-inset",
);

/** Job/run status chip — pass the job status or a simplified tone. */
export function productStatus(tone: string): string {
  if (tone === "ok" || tone === "healed") {
    return cn(
      statusBase,
      "text-text-success-base bg-surface-success-weak ring-border-success-base/35",
    );
  }
  if (tone === "error" || tone === "cancelled") {
    return cn(
      statusBase,
      "text-text-critical-base bg-surface-critical-weak ring-border-critical-base/35",
    );
  }
  if (tone === "running" || tone === "paused" || tone === "queued") {
    return cn(
      statusBase,
      "text-text-interactive-base bg-surface-interactive-weak ring-border-interactive-base/35",
    );
  }
  return cn(statusBase, "text-text-base bg-surface-raised-strong ring-border-weak-base");
}

export function kindPillTone(kind: string): string {
  switch (kind) {
    case "tap":
    case "type":
    case "key":
    case "scroll":
    case "swipe":
      return "bg-surface-interactive-weak text-text-interactive-base ring-border-interactive-base/40";
    case "expect":
    case "expect-set":
    case "expect-screen":
    case "wait-for":
      return "bg-surface-success-weak text-text-success-base ring-border-success-base/40";
    case "sleep":
    case "pause":
      return "bg-surface-warning-weak text-icon-warning-base ring-border-warning-base/40";
    case "screenshot":
      return "bg-surface-info-weak text-icon-info-base ring-border-info-base/40";
    case "flow":
      return "bg-surface-interactive-weak text-text-interactive-base ring-border-interactive-base/35";
    default:
      return "";
  }
}

/** Soft status chip — tint + ring (never solid inverted blocks) */
export const statusPill = cn(
  "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5",
  "text-caption font-medium tracking-tight ring-1 ring-inset",
);

export function statusPillTone(tone: "pass" | "heal" | "fail" | "run" | "idle" | string): string {
  switch (tone) {
    case "pass":
    case "heal":
      return "bg-surface-success-weak text-icon-success-base ring-border-success-base/40";
    case "fail":
      return "bg-surface-critical-weak text-text-critical-base ring-border-critical-base/40";
    case "run":
      return "bg-surface-info-weak text-icon-info-base ring-border-info-base/40";
    default:
      return "bg-surface-base text-text-strong ring-border-weak-base";
  }
}

export const listPanel = cn(
  "overflow-hidden rounded-lg",
  "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base",
);
