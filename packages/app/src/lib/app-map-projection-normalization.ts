import type { Accessor } from "solid-js";
import type { AppMapCanvasState } from "@relay/protocol";
import { persistCoincidentPositionRepair } from "./app-map-destack";
import { withCanvasGraph } from "./app-map-canvas-graph";

type PersistMetadata = (
  value: AppMapCanvasState,
  settings: { before: AppMapCanvasState; recordHistory: false },
) => void;

/** Repairs impossible saved geometry at the canonical document boundary. */
export function appMapProjectionNormalizer(
  persist: PersistMetadata,
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>,
) {
  return (projection: AppMapCanvasState): AppMapCanvasState => {
    let normalized = projection;
    persistCoincidentPositionRepair(projection.positions, (positions) => {
      normalized = withCanvasGraph({ ...projection, positions }, graph());
      persist(normalized, { before: projection, recordHistory: false });
    });
    return normalized;
  };
}
