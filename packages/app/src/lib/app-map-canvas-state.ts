import type { AppMapCanvasState } from "@relay/protocol";

export const EMPTY_APP_MAP_CANVAS_STATE: AppMapCanvasState = {
  schemaVersion: 1,
  positions: {},
  groups: [],
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
  review: { state: "draft", updatedAt: 0 },
  graph: { schemaVersion: 1, screens: [], transitions: [], flows: [] },
};
