/**
 * Shared Tailwind class recipes — dense dark workbench chrome.
 */
import { cn } from "./cn";

export const btn = cn(
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent",
  "px-3 text-[12.5px] font-medium transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-35",
);

export const btnGhost = cn(
  btn,
  "bg-transparent text-white/55 hover:enabled:bg-white/[0.06] hover:enabled:text-white/90",
);

export const btnGhostOn = cn(btnGhost, "bg-accent/15 text-accent-soft");

export const btnAcc = cn(
  btn,
  "h-8 bg-accent px-3.5 font-semibold text-accent-fg shadow-sm hover:enabled:brightness-110",
  "disabled:bg-accent/25 disabled:text-white/40 disabled:opacity-100",
);

export const btnBordered = cn(btnGhost, "border-white/10 bg-white/[0.03]");

export const seg = cn(
  "inline-flex items-center gap-px rounded-lg border border-white/10 bg-black/30 p-0.5",
);

export const segBtn = cn(
  "h-7 rounded-md px-2.5 text-xs font-medium text-white/45 transition-colors",
  "hover:text-white/80",
);

export const segBtnOn = cn(segBtn, "bg-white/10 text-white shadow-sm");

export const segBtnRec = cn(segBtnOn, "bg-fail/20 text-fail");

export const mono = "font-mono tabular-nums";

/** Full-height dark instrument surface */
export const surfaceDeep = "bg-[#0b0c10] text-white/90";
export const surfacePanel = "bg-[#111318] text-white/90";
export const surfaceRaised = "bg-[#161920]";
export const borderSubtle = "border-white/[0.07]";
export const textMuted = "text-white/45";
export const textFaint = "text-white/30";

/** Step row — Uber-density list item */
export const stepRow = cn(
  "group relative flex min-h-[52px] w-full items-center gap-3 border-b border-white/[0.06]",
  "px-4 py-2.5 text-left transition-colors",
);
export const stepRowSelected = cn("bg-accent/12 shadow-[inset_3px_0_0_0_var(--color-accent)]");
export const stepRowHover = "hover:bg-white/[0.03]";
