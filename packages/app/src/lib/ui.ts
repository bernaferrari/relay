/**
 * Stage UI recipes — AgentBoard token discipline.
 *
 * RULES (do not break):
 * 1. Solid paper = bg-surface-raised-stronger-non-alpha | bg-background-stronger
 *    NEVER use bg-surface-raised-base as a solid panel (it is ~3% alpha wash).
 * 2. Alpha washes only for hover/active: surface-raised-base-hover, surface-base-active.
 * 3. Primary ink = text-text-strong. Actions/icons on rows = text-text-strong.
 *    text-text-weak / text-text-weaker only for true secondary meta.
 * 4. List selection = AB: hover:bg-surface-raised-base-hover + active:bg-surface-base-active.
 * 5. Buttons = recipes below (or @relay/ui Button data-component). One system.
 * 6. Type = AB scale: text-12-regular/medium, text-14-regular/medium, text-16-medium.
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

/* ─── Type scale (AgentBoard text-12 / text-14 / text-16) ─── */
export const type12 = "text-12-regular";
export const type12Med = "text-12-medium";
export const type14 = "text-14-regular";
export const type14Med = "text-14-medium";
export const type16Med = "text-16-medium";

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

/* ─── Surfaces ─── */
/** App chrome deep plate */
export const surfaceDeep = "bg-v2-background-bg-deep text-text-strong";
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

/* ─── Buttons (single system) ─── */
/**
 * Text buttons — color wash only (no press scale). Prefer @relay/ui Button
 * when adding new surfaces; recipes remain for dense product chrome.
 */
export const btn = cn(
  "inline-flex h-7 min-h-7 items-center justify-center gap-1.5 rounded-md",
  "border border-transparent px-2.5",
  "text-12-medium text-text-strong select-none",
  tColor,
  "disabled:cursor-not-allowed disabled:text-text-weak",
);

/** Full-width / chrome bar control — color wash only, no scale */
export const btnBar = cn(
  "inline-flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5",
  "text-left text-12-medium text-text-strong select-none",
  "transition-[background-color,box-shadow,color,border-color] duration-150",
  easeOut,
  "disabled:cursor-not-allowed disabled:text-text-weak",
);

/** AgentBoard ghost — transparent, strong ink, hover wash */
export const btnGhost = cn(
  btn,
  "bg-transparent text-text-strong",
  "hover:enabled:bg-surface-base-hover",
);

export const btnGhostOn = cn(btnGhost, "bg-surface-base-active");

/** Product primary CTA — AB ink primary (not brand pastel). Prefer <Button variant="primary">. */
export const btnAcc = cn(btn, "btn-primary-ink px-3");
export const btnPrimaryInk = btnAcc;

/** Secondary solid paper + border */
export const btnBordered = cn(
  btn,
  "border-transparent bg-button-secondary-base text-text-strong shadow-xs-border-base",
  "hover:enabled:bg-button-secondary-hover",
);

/** @deprecated Prefer <IconButton variant="ghost" size="normal"> from @relay/ui */
export const iconBtn = cn(
  "grid size-6 shrink-0 place-items-center rounded-md select-none",
  "text-icon-base",
  "transition-[background-color,color,opacity] duration-150",
  easeHover,
  "hover:enabled:bg-surface-base-hover hover:enabled:text-text-strong",
  "active:enabled:bg-surface-base-active",
  "disabled:cursor-default disabled:opacity-50",
);

/** Phone chrome controls — colors from [data-device-chrome] only */
export const btnOnDevice = cn(
  "inline-flex h-7 min-h-7 items-center justify-center gap-1.5 px-3 rounded-md",
  "text-12-medium select-none",
  tColor,
  "disabled:cursor-not-allowed",
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
  "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-12-medium text-text-base select-none",
  tColor,
  "hover:bg-surface-raised-base-hover hover:text-text-strong",
);

export const segBtnOn = cn(
  "h-7 rounded-md px-2.5 text-12-medium text-text-strong select-none",
  "bg-surface-raised-stronger-non-alpha shadow-xs-border-base",
  tColor,
);

export const segBtnRec = cn(
  segBtnOn,
  "bg-surface-critical-weak text-icon-critical-base ring-border-critical-base/40",
);

/** Full-width segmented control for dense property inspectors. */
export const propertySeg = cn(
  "relative isolate inline-flex h-8 w-full items-center rounded-lg bg-[var(--v2-background-bg-layer-01)] p-0.5",
  "ring-1 ring-inset ring-[var(--v2-border-border-muted)]",
);

/**
 * Shared, sliding selection surface for the inspector's small segmented
 * controls. The value moves independently of the labels, so changing a
 * gesture retains its spatial continuity instead of flashing between states.
 */
export const propertySegIndicator = cn(
  "pointer-events-none absolute inset-y-0.5 left-0.5 z-0 rounded-md",
  "bg-[var(--v2-background-bg-layer-03)] shadow-[0_1px_3px_rgb(0_0_0/24%)]",
  "transition-transform duration-[180ms] [transition-timing-function:cubic-bezier(.2,.8,.2,1)] will-change-transform",
  "motion-reduce:transition-none",
);

const propertySegBtnBase = cn(
  "relative z-[1] inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded-md px-2",
  "text-[10.5px] font-medium text-[var(--text-weak)] select-none",
  "transition-[background-color,color,box-shadow,transform] duration-100 ease-out",
  "active:enabled:scale-[0.98]",
);

export const propertySegBtn = cn(
  propertySegBtnBase,
  "hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-base)]",
);

export const propertySegBtnOn = cn(
  propertySegBtnBase,
  "text-[var(--text-strong)] hover:enabled:bg-transparent",
);

export const mono = "font-mono tabular-nums";

export const fieldLabel = cn(
  "w-16 shrink-0 pt-[9px] text-[11px] leading-none font-normal text-text-base",
);

export const fieldInput = cn(
  "h-8 min-w-0 w-full rounded-md bg-surface-raised-stronger-non-alpha px-2.5",
  "text-[11px] font-normal text-text-strong ring-1 ring-inset ring-border-weak-base",
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
  "grid size-[26px] shrink-0 place-items-center rounded-[7px]",
  "text-12-medium leading-none tabular-nums",
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
  "text-12-medium tracking-wide text-text-base",
  "bg-surface-base ring-1 ring-inset ring-border-weak-base",
);

/* ─── Product chrome (studio / pages) — prefer these over .relay-* CSS ─── */

/** Uppercase section label used across shell surfaces */
export const eyebrow = cn(
  "block text-[11px]/[1.2] font-semibold tracking-[0.09em] text-text-weak uppercase",
);

/**
 * One underline-tab grammar for every secondary tab strip in the product
 * (Steps/Inputs/YAML, the run report's Timeline/Overview/Checks/...). Pair
 * with `tabUnderlineActive` on the selected tab.
 */
export const tabUnderline = cn(
  "relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5",
  "text-[12.5px]/[1.25] font-semibold text-text-weaker transition-colors",
  "after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:scale-x-0",
  "after:rounded-full after:bg-surface-brand-base after:transition-transform",
  "hover:enabled:bg-surface-raised-base-hover hover:enabled:text-text-weak focus-visible:outline-1 focus-visible:outline-border-strong-focus",
);

export const tabUnderlineActive = "text-text-strong after:scale-x-100";

const productControl = cn(
  "inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[10px] px-3.5",
  "text-[13px] font-semibold select-none",
  "transition-[color,background-color,box-shadow,transform] duration-150",
  "active:enabled:scale-[0.97]",
  "disabled:cursor-not-allowed",
);

/** Brand/product primary CTA (tests, maps, run actions) — same purple as Record/Run */
export const productPrimary = cn(
  productControl,
  "bg-[#705ff0] text-white shadow-[inset_0_1px_rgb(255_255_255/18%),0_7px_22px_rgb(89_69_214/18%)]",
  "hover:enabled:bg-[#7d6df5]",
  "disabled:bg-surface-raised-strong disabled:text-text-weaker disabled:shadow-[inset_0_0_0_1px_var(--border-weak-base)]",
  "data-[blocked]:cursor-not-allowed data-[blocked]:bg-surface-raised-strong data-[blocked]:text-text-weaker data-[blocked]:shadow-[inset_0_0_0_1px_var(--border-weak-base)]",
);

/** Quiet secondary control */
export const productSecondary = cn(
  productControl,
  "bg-surface-raised-strong text-text-base shadow-[inset_0_0_0_1px_var(--border-weak-hover)]",
  "hover:enabled:bg-surface-raised-stronger-non-alpha hover:enabled:text-text-strong",
  "disabled:bg-background-base disabled:text-text-weaker disabled:shadow-[inset_0_0_0_1px_var(--border-weak-base)]",
);

/** 34×34 chrome icon button */
export const productIconButton = cn(
  "inline-grid size-[34px] shrink-0 place-items-center rounded-[9px] text-text-base select-none",
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
  "min-h-0 flex-1 overflow-y-auto bg-v2-background-bg-deep",
  "pt-8 pb-14 px-[clamp(1.5rem,4vw,3.5rem)]",
);

export const productPageHero = cn(
  "mx-auto mb-8 flex max-w-[1180px] items-start justify-between gap-6",
);

export const productPageTitle = cn(
  "m-0 text-[30px] font-semibold leading-[1.12] tracking-[-0.035em] text-balance text-text-strong",
);

export const productPageLead = cn("m-0 max-w-[720px] text-[13px]/[1.45] text-text-base");

/* Colorless base — tones append exactly one text- and one bg- pair (cn never merges). */
const statusBase = cn(
  "inline-flex w-fit min-h-[22px] items-center gap-1 rounded-md px-2",
  "text-[11px] font-semibold ring-1 ring-inset",
);

/** Job/run status chip — pass the job status or a simplified tone. */
export function productStatus(tone: string): string {
  if (tone === "ok" || tone === "healed") {
    return cn(
      statusBase,
      "text-icon-success-base bg-surface-success-weak ring-border-success-base/35",
    );
  }
  if (tone === "error" || tone === "cancelled") {
    return cn(
      statusBase,
      "text-icon-critical-base bg-surface-critical-weak ring-border-critical-base/35",
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
    case "wait-for":
      return "bg-surface-success-weak text-icon-success-base ring-border-success-base/40";
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
  "text-12-medium tracking-tight ring-1 ring-inset",
);

export function statusPillTone(tone: "pass" | "heal" | "fail" | "run" | "idle" | string): string {
  switch (tone) {
    case "pass":
    case "heal":
      return "bg-surface-success-weak text-icon-success-base ring-border-success-base/40";
    case "fail":
      return "bg-surface-critical-weak text-icon-critical-base ring-border-critical-base/40";
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
