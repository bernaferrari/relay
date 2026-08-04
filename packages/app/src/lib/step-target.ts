/**
 * Shared StepTarget helpers — target strategy metadata, parsing/formatting,
 * and validity. Used by the run-pane's inline step editor (components/
 * step-list.tsx) and, previously, the standalone recipe editor modal (now
 * deleted — the run pane IS the editor).
 */
import type { StepTarget } from "./api-types";

export type Strategy = "identifier" | "ref" | "label" | "text" | "point";

export const STRATEGIES: { id: Strategy; label: string; placeholder: string }[] = [
  { id: "identifier", label: "Stable ID", placeholder: "e.g. chat_text_input" },
  { id: "ref", label: "Element @ref", placeholder: "e.g. @e26" },
  { id: "label", label: "Label", placeholder: "e.g. Sign in" },
  { id: "text", label: "Text", placeholder: "e.g. Welcome back" },
  { id: "point", label: "Point", placeholder: "e.g. 540, 1200" },
];

export function defaultStrategy(t: StepTarget | undefined): Strategy {
  if (!t) return "label";
  if (t.identifier) return "identifier";
  if (t.ref) return "ref";
  if (t.label) return "label";
  if (t.text) return "text";
  if (t.point) return "point";
  return "label";
}

export function parsePoint(text: string): { x: number; y: number } | undefined {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const x = parseInt(parts[0] ?? "", 10);
  const y = parseInt(parts[1] ?? "", 10);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return undefined;
}

export function fmtPoint(p?: { x: number; y: number }): string {
  return p ? `${p.x}, ${p.y}` : "";
}

export function targetValid(t: StepTarget | undefined): boolean {
  return Boolean(t && (t.identifier || t.ref || t.label || t.text || t.point));
}

/**
 * The captured target fields a tap recorded, best-first (ref · label · text ·
 * point) — each with its value, for the one-click retargeting chain.
 */
export function detectedChain(
  t: StepTarget | undefined | null,
): { id: Strategy; label: string; value: string }[] {
  if (!t) return [];
  const out: { id: Strategy; label: string; value: string }[] = [];
  if (t.identifier) out.push({ id: "identifier", label: "Stable ID", value: t.identifier });
  if (t.ref) out.push({ id: "ref", label: "Ref", value: t.ref });
  if (t.label) out.push({ id: "label", label: "A11y label", value: `"${t.label}"` });
  if (t.text) out.push({ id: "text", label: "Text", value: `"${t.text}"` });
  if (t.point) out.push({ id: "point", label: "X, Y", value: fmtPoint(t.point) });
  return out;
}
