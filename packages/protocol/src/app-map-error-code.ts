/** Stable failures returned by App Map mutations and validation. */
export type AppMapErrorCode =
  | "invalid-map"
  | "scope-mismatch"
  | "revision-conflict"
  | "duplicate-id"
  | "missing-reference"
  | "in-use"
  | "proposal-state"
  | "history-empty"
  | "history-conflict";
