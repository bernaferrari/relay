export type InteractiveStep =
  | { kind: "ref"; ref: string }
  | { kind: "label"; label: string }
  | { kind: "text-match"; match: string }
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
    case "ref":
      return { kind: "ref", ref: step.ref };
    case "label":
      return { kind: "label", label: step.label };
    case "text-match":
      return { kind: "text-match", match: step.match };
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
