/** Click-to-connect while a path is being drafted from one screen. */

export type PathDraftClick =
  | { kind: "idle" }
  | { kind: "cancel" }
  | { kind: "connect"; fromScreenId: string; toScreenId: string };

/**
 * Adding a path is click → click, not drag-to-empty (the FigJam clone).
 * Empty canvas or the source screen cancels. Another screen connects.
 */
export function pathDraftClick(input: {
  sourceScreenId: string | null | undefined;
  clickedScreenId: string | null | undefined;
}): PathDraftClick {
  const source = input.sourceScreenId?.trim();
  if (!source) return { kind: "idle" };
  const clicked = input.clickedScreenId?.trim();
  if (!clicked || clicked === source) return { kind: "cancel" };
  return { kind: "connect", fromScreenId: source, toScreenId: clicked };
}

export const NEXT_SCREEN_TOAST =
  "Next screen added. Name it — Undo or Delete if that wasn’t right.";

export const PATH_ADDED_TOAST = "Path added. Record taps when ready, or Delete to remove it.";

export const PATH_REMOVED_TOAST = "Path removed. The screens are still on the map.";
