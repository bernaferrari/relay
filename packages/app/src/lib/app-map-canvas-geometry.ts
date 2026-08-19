import { createMemo, type Accessor } from "solid-js";
import type { ScreenshotOrientationEvidence } from "../components/oriented-screenshot";
import type { CanvasConnection } from "./app-map-connection-draft";
import {
  canvasEdgeGeometry,
  screenCardGeometry,
  type CanvasPoint,
  type CanvasScreenRotation,
  type ScreenCardGeometry,
} from "./app-map-canvas-layout";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "./app-map-connector-lanes";
import { isUnarrangedCrawlFiling } from "./app-map-crawl-filing";
import { resolveCoincidentPositions } from "./app-map-destack";
import type { MapTreeNode } from "./app-map-tree";

/**
 * Where every screen card and every connector actually lands. Marquee
 * hit-testing, the scene and the connector lanes all have to agree about this
 * or a drag selects one thing and highlights another, so it is derived once.
 */
export function appMapCanvasGeometry(input: {
  nodes: Accessor<MapTreeNode[]>;
  connections: Accessor<CanvasConnection[]>;
  rotations: Accessor<Record<string, CanvasScreenRotation>>;
  /** Persisted geometry. A screen the graph has but the document has not
   * positioned yet falls back to the tree's own coordinate, which is the tidy
   * journey for the whole graph. */
  savedPositions: Accessor<Readonly<Record<string, CanvasPoint>>>;
  orientationFor: (node: MapTreeNode) => ScreenshotOrientationEvidence | undefined;
}) {
  // Saved geometry minus the two things no arrangement could have meant: stacks,
  // and a whole map that is still the lattice an accepted crawl filed it into.
  // Both fall through to the tidy layout the tree already carries. Only the
  // reading is repaired; the save path writes what the document says, so the
  // journey a person has been looking at becomes the document on their first
  // edit rather than behind their back.
  const positions = createMemo(() => {
    const saved = input.savedPositions();
    return isUnarrangedCrawlFiling(saved) ? {} : resolveCoincidentPositions(saved);
  });
  const positionFor = (node: MapTreeNode): CanvasPoint => positions()[node.id] ?? node;
  const resolvedPositions = createMemo(() =>
    Object.fromEntries(input.nodes().map((node) => [node.id, positionFor(node)] as const)),
  );
  const geometryForNode = (node: MapTreeNode): ScreenCardGeometry =>
    screenCardGeometry(input.orientationFor(node));
  const screenGeometries = createMemo<Record<string, ScreenCardGeometry>>(() =>
    Object.fromEntries(input.nodes().map((node) => [node.id, geometryForNode(node)] as const)),
  );
  const autoConnectionLanes = createMemo(() =>
    connectorAutoLanes(
      input.connections(),
      (screenId) => {
        const node = input.nodes().find((candidate) => candidate.id === screenId);
        return node ? positionFor(node) : undefined;
      },
      (screenId) => screenGeometries()[screenId],
    ),
  );
  const connectionGeometries = () =>
    input.connections().map((connection) => ({
      id: connection.id,
      geometry: canvasEdgeGeometry(
        {
          from: connection.fromScreenId,
          to: connection.toScreenId,
          kind: connection.kind,
          sourceAnchor: connection.sourceAnchor,
          sourceRotation: input.rotations()[connection.fromScreenId],
          presentation: connectorPresentationWithAutoLane(connection, autoConnectionLanes()),
          automaticSourceLane: connectorHasAutomaticSourceLane(connection, autoConnectionLanes()),
        },
        input.nodes(),
        positionFor,
        undefined,
        geometryForNode,
      ),
    }));
  return {
    positionFor,
    resolvedPositions,
    geometryForNode,
    screenGeometries,
    connectionGeometries,
  };
}
