export type TooltipSide = "top" | "bottom";

export type TooltipRect = { left: number; top: number; width: number; height: number };

export type TooltipPlacement = { left: number; top: number; side: TooltipSide };

export const TOOLTIP_GAP = 8;
export const TOOLTIP_MARGIN = 8;

/**
 * Place a tooltip under its anchor, flipping above only when there is genuinely
 * no room below, and clamping horizontally so a control at the window edge does
 * not push its own label off screen. Pure so the geometry is testable without a
 * browser.
 */
export function tooltipPlacement(input: {
  anchor: TooltipRect;
  tooltip: { width: number; height: number };
  viewport: { width: number; height: number };
  prefer?: TooltipSide;
}): TooltipPlacement {
  const { anchor, tooltip, viewport } = input;
  const needed = tooltip.height + TOOLTIP_GAP;
  const roomBelow = viewport.height - (anchor.top + anchor.height);
  const roomAbove = anchor.top;
  const prefer = input.prefer ?? "bottom";

  let side: TooltipSide = prefer;
  if (prefer === "bottom" && roomBelow < needed && roomAbove >= needed) side = "top";
  if (prefer === "top" && roomAbove < needed && roomBelow >= needed) side = "bottom";

  const top =
    side === "bottom" ? anchor.top + anchor.height + TOOLTIP_GAP : anchor.top - needed + 0;

  const centered = anchor.left + anchor.width / 2 - tooltip.width / 2;
  const maxLeft = viewport.width - tooltip.width - TOOLTIP_MARGIN;
  const left = Math.round(
    Math.min(Math.max(TOOLTIP_MARGIN, centered), Math.max(TOOLTIP_MARGIN, maxLeft)),
  );

  return { left, top: Math.round(Math.max(TOOLTIP_MARGIN, top)), side };
}

/** The label a control wants shown, or null when it has nothing to add. A
 * tooltip that only repeats visible text is noise, so an anchor whose own text
 * already says the same thing is skipped. */
export function tooltipLabelFor(element: {
  tip: string | null;
  text: string | null;
  disabled: boolean;
}): string | null {
  const tip = element.tip?.trim();
  if (!tip || element.disabled) return null;
  const text = element.text?.trim().replace(/\s+/g, " ") ?? "";
  if (text && text.toLowerCase() === tip.toLowerCase()) return null;
  return tip;
}
