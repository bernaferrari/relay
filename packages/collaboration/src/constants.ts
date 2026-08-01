/** Version of the Yjs layout, independent from JourneyMetadata's schema version. */
export const COLLABORATIVE_JOURNEY_SCHEMA_VERSION = 1 as const;

/** The one top-level Y.Map stored in a collaborative Journey Y.Doc. */
export const COLLABORATIVE_JOURNEY_ROOT_KEY = "relay-collaborative-journey" as const;

/**
 * Stable keys beneath COLLABORATIVE_JOURNEY_ROOT_KEY. These names are transport
 * and persistence format, so changing one requires a new collaborative schema.
 */
export const COLLABORATIVE_JOURNEY_ROOT_KEYS = Object.freeze({
  schemaVersion: "schemaVersion",
  screens: "screens",
  connections: "connections",
  flows: "flows",
  positions: "positions",
  notes: "notes",
  draft: "draft",
} as const);

/** Safe, non-authoritative legacy canvas labels retained during v6 authoring. */
export const COLLABORATIVE_JOURNEY_DRAFT_KEYS = Object.freeze({
  screenTitles: "screenTitles",
  edgeLabels: "edgeLabels",
  edgeKinds: "edgeKinds",
} as const);

export const COLLABORATIVE_JOURNEY_LIMITS = Object.freeze({
  documentBytes: 4 * 1024 * 1024,
  updateBytes: 4 * 1024 * 1024,
  stateVectorBytes: 256 * 1024,
  idLength: 256,
  stringLength: 32 * 1024,
  noteLength: 64 * 1024,
  screens: 2_000,
  connections: 8_000,
  flows: 256,
  positions: 4_000,
  notes: 2_000,
  observationsPerScreen: 256,
  referencesPerConnection: 1_024,
} as const);

/** Internal per-entity field used to recover canonical array order. */
export const COLLABORATIVE_JOURNEY_ORDER_FIELD = "$order" as const;
