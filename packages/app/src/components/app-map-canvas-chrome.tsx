import type { CanvasBounds } from "../lib/app-map-canvas-layout";
import type { AppMapMinimapBounds } from "../lib/app-map-minimap";
import { AppMapMinimap, type AppMapMinimapEdge, type AppMapMinimapNode } from "./app-map-minimap";
import { AppMapToolbar, type AppMapCanvasTool } from "./app-map-toolbar";

/**
 * Everything that floats over the canvas without belonging to it: the tools a
 * person edits with, and the overview they navigate with. They share the same
 * shift when a side panel opens, so keeping them together is what stops one
 * from sliding out from under the other.
 */
export function AppMapCanvasChrome(props: {
  tool: AppMapCanvasTool;
  deviceOpen: boolean;
  shiftForSidePanel: boolean;
  wideDevice: boolean;
  explorationState: "idle" | "running" | "stopping" | "complete" | "error";
  explorationCount: number;
  scale: number;
  nodes: AppMapMinimapNode[];
  edges: AppMapMinimapEdge[];
  bounds: CanvasBounds;
  viewport: AppMapMinimapBounds;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onAddNote: () => void;
  onExplore: () => void;
  onToggleDevice: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomTo: (scale: number) => void;
  onFit: () => void;
  onNavigate: (ratio: { x: number; y: number }) => void;
}) {
  return (
    <>
      <AppMapToolbar
        tool={props.tool}
        deviceOpen={props.deviceOpen}
        shiftForDevice={props.shiftForSidePanel}
        wideDevice={props.wideDevice}
        explorationState={props.explorationState}
        explorationCount={props.explorationCount}
        onToolChange={props.onToolChange}
        onAddNote={props.onAddNote}
        onExplore={props.onExplore}
        onToggleDevice={props.onToggleDevice}
      />
      <AppMapMinimap
        scale={props.scale}
        groups={[]}
        nodes={props.nodes}
        edges={props.edges}
        bounds={props.bounds}
        viewport={props.viewport}
        shiftForSidePanel={props.shiftForSidePanel}
        wideDevice={props.wideDevice}
        onZoomOut={props.onZoomOut}
        onZoomIn={props.onZoomIn}
        onZoomTo={props.onZoomTo}
        onFit={props.onFit}
        onNavigate={props.onNavigate}
      />
    </>
  );
}
