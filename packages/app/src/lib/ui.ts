/**
 * Shared Tailwind class recipes — the only “components” layer.
 * Prefer these over one-off strings for buttons / segments.
 */
import { cn } from "./cn";

export const btn = cn(
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-transparent",
  "px-3 text-[12.5px] font-medium transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-40",
);

export const btnGhost = cn(
  btn,
  "bg-transparent text-text-muted hover:enabled:bg-hover hover:enabled:text-text",
);

export const btnGhostOn = cn(btnGhost, "bg-accent/12 text-accent-soft");

export const btnAcc = cn(
  btn,
  "h-[34px] bg-accent px-4 font-semibold text-accent-fg hover:enabled:brightness-105",
);

export const btnBordered = cn(btnGhost, "border-border");

export const seg = cn(
  "inline-flex items-center gap-px rounded-[9px] border border-border bg-layer-2 p-0.5",
);

export const segBtn = cn(
  "h-7 rounded-md px-2.5 text-xs font-medium text-text-muted transition-colors",
  "hover:text-text",
);

export const segBtnOn = cn(segBtn, "bg-layer-1 text-text shadow-sm");

export const segBtnRec = cn(segBtnOn, "text-fail");

export const mono = "font-mono tabular-nums";
