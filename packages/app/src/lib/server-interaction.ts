export type InteractiveStep =
  | { kind: "identifier"; identifier: string; point?: { x: number; y: number } }
  | { kind: "ref"; ref: string }
  | { kind: "label"; label: string; point?: { x: number; y: number } }
  | { kind: "text-match"; match: string; point?: { x: number; y: number } }
  | { kind: "point"; x: number; y: number }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
    }
  | { kind: "type"; text: string };

export function interactionBody(step: InteractiveStep): Record<string, unknown> {
  switch (step.kind) {
    case "identifier":
      return {
        kind: "identifier",
        identifier: step.identifier,
        ...(step.point ? { point: step.point } : {}),
      };
    case "ref":
      return { kind: "ref", ref: step.ref };
    case "label":
      return {
        kind: "label",
        label: step.label,
        ...(step.point ? { point: step.point } : {}),
      };
    case "text-match":
      return {
        kind: "text-match",
        match: step.match,
        ...(step.point ? { point: step.point } : {}),
      };
    case "point":
      return { kind: "point", x: step.x, y: step.y };
    case "swipe":
      return {
        kind: "swipe",
        from: step.from,
        to: step.to,
        ...(step.durationMs ? { durationMs: step.durationMs } : {}),
      };
    case "type":
      return { kind: "type", text: step.text };
  }
}
