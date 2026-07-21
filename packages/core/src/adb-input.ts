export type InputPoint = { x: number; y: number };

function integerArgument(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return Math.round(value);
}

/** Build the integer-only argument list accepted by Android's `input swipe`. */
export function adbSwipeInputArgs(from: InputPoint, to: InputPoint, durationMs: number): string[] {
  return [
    "input",
    "swipe",
    String(integerArgument(from.x, "from.x")),
    String(integerArgument(from.y, "from.y")),
    String(integerArgument(to.x, "to.x")),
    String(integerArgument(to.y, "to.y")),
    String(Math.max(1, integerArgument(durationMs, "durationMs"))),
  ];
}
