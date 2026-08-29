import type { AppMapEntity } from "./app-map.js";

/** A reviewed declaration that one captured surface represents a stable
 * product state. Visible titles and platform screen classes are evidence, not
 * the identity shared by a cross-platform Test. */
export type ReviewedLogicalStateBinding = {
  logicalStateId: string;
  revision: number;
  reviewedAt: number;
  reviewedBy: string;
};

/** A reviewed declaration that one concrete navigation edge implements a
 * stable business action. Selectors and coordinates remain platform-local. */
export type ReviewedActionIntentBinding = {
  intentId: string;
  revision: number;
  reviewedAt: number;
  reviewedBy: string;
};

export type LogicalProductState = AppMapEntity & {
  name: string;
  description?: string;
};

export type ProductActionIntent = AppMapEntity & {
  name: string;
  description?: string;
};
