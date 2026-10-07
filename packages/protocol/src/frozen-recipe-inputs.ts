import type { FrozenRunCase } from "./index.js";

/** Immutable public input identity. Sensitive values remain execution-local;
 * their placeholders and digest preserve the receipt without exposing them. */
export type FrozenRecipeInputReceipt = {
  schemaVersion: 1;
  projectDataRevision: number;
  seed: number;
  values: Record<string, string>;
  sensitiveInputNames: string[];
  valuesDigest: string;
  case?: FrozenRunCase;
};
