import type { ConnectionPresentation, MapGroup } from "./app-map.js";
import type { ScreenIdentity, ScreenObservation } from "./discovery-contract.js";
import type { RecipeStep } from "./recipes.js";

export type CanvasPosition = { x: number; y: number };

/**
 * Where an accepted crawl files a screen nobody has arranged yet.
 *
 * Both accept paths hand out slots from this fixed lattice in the order the
 * states were observed. That is a filing order, not a layout: it is legible and
 * never overlaps, but it reads as a contact sheet of phones rather than the
 * paths between them. The writer and the reader have to agree about the exact
 * geometry — the canvas recognises a map whose whole geometry is still this
 * lattice and shows it as a path instead — so the lattice lives here with
 * the rest of the canvas contract rather than in either of them.
 */
export const CRAWL_FILING_LATTICE = {
  origin: { x: 80, y: 100 },
  columns: 4,
  columnPitch: 300,
  rowPitch: 420,
} as const;

export function crawlFilingSlot(index: number): CanvasPosition {
  const { origin, columns, columnPitch, rowPitch } = CRAWL_FILING_LATTICE;
  return {
    x: origin.x + (index % columns) * columnPitch,
    y: origin.y + Math.floor(index / columns) * rowPitch,
  };
}

/** True for a point that is exactly where the crawl filed it. Sub-pixel drift
 * is somebody's arrangement, so the comparison is deliberately exact. */
export function isCrawlFilingSlot(point: CanvasPosition): boolean {
  const { origin, columns, columnPitch, rowPitch } = CRAWL_FILING_LATTICE;
  const column = (point.x - origin.x) / columnPitch;
  const row = (point.y - origin.y) / rowPitch;
  return (
    Number.isInteger(column) && column >= 0 && column < columns && Number.isInteger(row) && row >= 0
  );
}

/** A recorded interaction location projected into a screen preview. Values
 * are normalized to the captured viewport so the same evidence survives
 * responsive cards, zoom, and different canvas layouts. */
export type CanvasInteractionAnchor = {
  point: CanvasPosition;
  rect?: { x: number; y: number; width: number; height: number };
};
/** Non-executable context placed beside captured screens: a compact canvas
 * primitive for requirements, review decisions, or a reminder to branch. */
export type CanvasNote = CanvasPosition & {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};
/** A non-destructive edit of the evidence video attached to a transition. */
export type RecordingClip = {
  startMs: number;
  endMs: number;
};

/** Replay is the approval loop for one connection, independent from a full
 * Flow run. A draft can be refined repeatedly without losing its evidence. */
export type ConnectionTakeReview = {
  status: "draft" | "verified" | "failed";
  updatedAt: number;
  verifiedAt?: number;
  error?: string;
  /** Verification is recorded per target so one passing phone never hides a
   * failing tablet. The aggregate status remains useful for compact UI. */
  targets?: TargetVerification[];
};

export type TargetVerification = {
  targetId: string;
  targetName?: string;
  platform?: "android" | "ios" | "browser";
  status: "passed" | "failed" | "needs-review";
  checkedAt: number;
  observedFingerprint?: string;
  runId?: string;
  error?: string;
};

/** A captured pass before (or after) it becomes part of the executable path.
 * Keeping the raw step/evidence references here lets people resume review
 * after a restart without turning exploratory actions into the App Map. */
export type ConnectionTake = {
  id: string;
  recipeId: string;
  /** Explicit source keeps a paused/reloaded review attached to the screen
   * the person actually recorded from, rather than whichever card is selected
   * when they return. */
  sourceScreenId?: string;
  sourceObservation?: ScreenObservation;
  destinationObservation?: ScreenObservation;
  startedAt: number;
  finishedAt?: number;
  group: string;
  /** Local Relay video evidence captured through the physical iOS runner. */
  videoTakeId?: string;
  videoClip?: RecordingClip;
  state: "review" | "kept" | "discarded";
  steps: RecipeStep[];
};
/** A deliberately small, human-owned decision about the executable Flow.
 * It is separate from run evidence: someone can approve the authored path
 * while still reviewing a particular run against a visual baseline. */
export type MapReviewState = "draft" | "needs-review" | "approved" | "attention";

export type MapReview = {
  state: MapReviewState;
  updatedAt: number;
  approvedAt?: number;
};
/**
 * A prototype connection belongs to the canvas, not the runner. When it has a
 * `stepId` it describes a real recorded action; when it is pending it is an
 * intentional, visible reminder to record that interaction. This keeps the
 * graph honest while still letting someone sketch a route before recording it.
 */
export type PrototypeConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
  stepId?: string;
  /** Capture provenance remains attached to the canonical connection. */
  takeId?: string;
  videoTakeId?: string;
  videoClip?: RecordingClip;
  label?: string;
  state: "recorded" | "needs-recording";
  createdAt: number;
  updatedAt: number;
};

/**
 * Canvas projection of the canonical App Map. The projection is separate
 * from the executable recipe: it describes the screens a person sees and the
 * transitions they approve between those screens. The runner still receives a
 * plain ordered RecipeStep[] compiled from the transition step ids.
 *
 * This separation is what lets the canvas become collaborative and free-form
 * without making a partially-arranged diagram change what runs on a device.
 */
export type CanvasScreen = {
  id: string;
  title: string;
  /** Canonical semantic identity. Optional until evidence establishes it. */
  identity?: ScreenIdentity;
  /** Concrete captures known to represent this screen. */
  observations?: ScreenObservation[];
  /** The post-action capture used to render this card, when one exists. */
  representativeStepId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasDestination = { kind: "screen"; screenId: string } | { kind: "end" };

export type CanvasTransition = {
  id: string;
  fromScreenId: string;
  destination: CanvasDestination;
  /** Stable recipe action ids, in the exact order a person recorded them. */
  stepIds: string[];
  /** Immutable evidence committed in the same aggregate as this connection. */
  evidenceIds?: string[];
  /** The full take is evidence for the edge, not merely for either endpoint.
   * A video may contain loading, animation, or navigation that no single
   * discrete action can describe. */
  takeId?: string;
  videoTakeId?: string;
  videoClip?: RecordingClip;
  /** How the transition was authored. All modes still compile to execution steps. */
  mode?: "interaction" | "automatic" | "reusable";
  review?: ConnectionTakeReview;
  /** The first recorded interaction target, when the take captured one. */
  sourceAnchor?: CanvasInteractionAnchor;
  /** Where this edge came from. This makes repeated discovery imports
   * idempotent and keeps generated maps auditable without coupling execution
   * to a discovery session. */
  provenance?: {
    source: "recording" | "discovery" | "manual";
    externalId?: string;
    sessionId?: string;
  };
  label?: string;
  /** Durable canvas-only connector styling. It does not alter the actions the
   * runner executes. */
  presentation?: ConnectionPresentation;
  state: "recorded" | "needs-recording";
  kind: "forward" | "return";
  createdAt: number;
  updatedAt: number;
};

/** An App Map can expose more than one intentional Flow entry point. */
export type CanvasFlow = {
  id: string;
  name: string;
  screenId: string;
  /** Canonical App Map Routine executed before checking this entry screen. */
  setup?: { routineId: string; bindings?: Record<string, string> };
  /** Optional named target set. The same canonical route is replayed against
   * every profile in the set; device-specific forks remain exceptional. */
  targetSetId?: string;
  createdAt: number;
  updatedAt: number;
};

export type CanvasGraph = {
  schemaVersion: 1;
  screens: CanvasScreen[];
  transitions: CanvasTransition[];
  flows: CanvasFlow[];
};

/** A named device context for an App Map. Variant-specific captures can be
 * attached later without changing the authored route or its executable steps. */
export type DeviceVariant = {
  id: string;
  label: string;
  deviceId?: string;
  status: "current" | "verified" | "needs-review";
  updatedAt: number;
};

export type MapVerification = {
  state: "draft" | "verifying" | "needs-review" | "baselined";
  updatedAt: number;
  baselineAt?: number;
  baselineRunId?: string;
};

/** Canvas-only prototype data, projected from canonical App Map entities. */
export type ConnectionPrototype = {
  connections?: PrototypeConnection[];
  deviceVariants?: DeviceVariant[];
  verification?: MapVerification;
};
/**
 * Layout metadata is deliberately separate from a recipe's executable steps.
 * It lets the graph evolve and be rearranged without changing executable actions.
 */
export type AppMapCanvasState = {
  schemaVersion: 1;
  positions: Record<string, CanvasPosition>;
  /** Optional visual organization projected from canonical Map Groups. */
  groups?: MapGroup[];
  /** Human names for captured screens. Kept outside executable steps so the
   * graph can be clarified without changing what a runner performs. */
  screenTitles?: Record<string, string>;
  edgeLabels: Record<string, string>;
  edgeKinds: Record<string, string>;
  notes?: CanvasNote[];
  /** Versioned, non-executable recording review state. */
  takes?: ConnectionTake[];
  /** Human approval of the map; run-by-run visual approval stays in run evidence. */
  review?: MapReview;
  /** Canvas-only authoring, device coverage, and baseline state. */
  prototype?: ConnectionPrototype;
  /** Renderer projection of canonical App Map screens, connections, and flows. */
  graph?: CanvasGraph;
};
