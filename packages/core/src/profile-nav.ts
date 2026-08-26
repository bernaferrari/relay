/**
 * One navigation step inside a switcher profile path.
 *
 * Local to the profile modules: profiles describe how to walk from a cold open
 * to an option list, which is a fixed vocabulary of taps, waits and app
 * switches — not the protocol's operation surface.
 */
export type ProfileNavStep =
  | {
      kind: "tap";
      target: {
        stableKey?: string;
        identifier?: string;
        label?: string;
        text?: string;
        point?: { x: number; y: number };
      };
    }
  | { kind: "back" }
  | { kind: "wait"; ms: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number }
  | { kind: "relaunch" }
  /** Open/switch foreground app without requiring relaunch (deep-link handoff). */
  | { kind: "openApp"; app: string; relaunch?: boolean };
