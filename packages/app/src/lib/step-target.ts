/**
 * Shared StepTarget helpers — target strategy metadata, parsing/formatting,
 * and validity. Used by the run-pane's inline step editor (components/
 * step-list.tsx) and, previously, the standalone recipe editor modal (now
 * deleted — the run pane IS the editor).
 */
import type { StepTarget } from "./api-types";

export type Strategy = "ref" | "label" | "text" | "point";

export const STRATEGIES: { id: Strategy; label: string; placeholder: string }[] = [
  { id: "ref", label: "Element @ref", placeholder: "@e26" },
  { id: "label", label: "Label", placeholder: "Sign in" },
  { id: "text", label: "Text", placeholder: "Welcome back" },
  { id: "point", label: "Point", placeholder: "x, y" },
];

export function defaultStrategy(t: StepTarget | undefined): Strategy {
  if (!t) return "label";
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
  return Boolean(t && (t.ref || t.label || t.text || t.point));
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
  if (t.ref) out.push({ id: "ref", label: "Element", value: t.ref });
  if (t.label) out.push({ id: "label", label: "Label", value: `"${t.label}"` });
  if (t.text) out.push({ id: "text", label: "Text", value: `"${t.text}"` });
  if (t.point) out.push({ id: "point", label: "Point", value: fmtPoint(t.point) });
  return out;
}
