import type { JourneyMetadata } from "@relay/protocol";

export const EMPTY_JOURNEY_METADATA: JourneyMetadata = {
  schemaVersion: 6,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
  review: { state: "draft", updatedAt: 0 },
  graph: { schemaVersion: 1, screens: [], transitions: [], flows: [] },
};
