/** @jsxImportSource react */
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Compass, RotateCcw } from "lucide-react";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { MapAccessibilityOverlay } from "./map-accessibility-overlay";
import { canvasMapPaths } from "./map-path-groups";
import { isMapReturn } from "./map-edge-paths";
import { MapEdges, isRoutineReturn } from "./map-edges";
import { mapClusters } from "./map-clusters";
import { MapFrameTitle } from "./map-frame-title";
import { MapScreenPreview } from "./map-screen-preview";
import {
  containedImageRect,
  type ImageDimensions,
  type MapPoint,
  type MapNodeSize,
  type MapTransform,
} from "./map-canvas-geometry";
import type { AlignmentGuide } from "./map-alignment";

export type MapCanvasNodeDrag = {
  id: string;
  start: MapPoint;
  position: MapPoint;
  moved: boolean;
  members: Map<string, MapPoint>;
};

type RefLike<T> = { current: T };

export function MapCanvasWorld({
  worldRef,
  transformRef,
  navigationFrame,
  nodeDrag,
  suppressNodeClick,
  alignmentGuides,
  visibleScreens,
  visiblePaths,
  originPaths,
  positions,
  selectedPathId,
  markerId,
  selectedScreenId,
  selectedIds,
  panningTool,
  showControlOrigins,
  showInteractionTargets,
  imageDimensions,
  node,
  layoutMode,
  loadScreenshot,
  loadAccessibilityTree,
  setImageDimensions,
  onSelectScreen,
  clearSelectedScreen,
  setSelectedIds,
  onFocusScreen,
  onRevealScreen,
  onSelectPath,
  alignedDragPosition,
  setAlignmentGuides,
  setDragged,
  setArrangedEdits,
  onUpdateScreen,
  saving,
}: {
  worldRef: RefLike<HTMLDivElement | null>;
  transformRef: RefLike<MapTransform>;
  navigationFrame: RefLike<number>;
  nodeDrag: RefLike<MapCanvasNodeDrag | undefined>;
  suppressNodeClick: RefLike<boolean>;
  alignmentGuides: readonly AlignmentGuide[];
  visibleScreens: readonly ProductMapScreen[];
  visiblePaths: readonly ProductMapPath[];
  originPaths: readonly ProductMapPath[];
  positions: Map<string, MapPoint>;
  selectedPathId: string | undefined;
  markerId: string;
  selectedScreenId: string | undefined;
  selectedIds: Set<string>;
  panningTool: boolean;
  showControlOrigins: boolean;
  showInteractionTargets: boolean;
  imageDimensions: Map<string, ImageDimensions>;
  node: MapNodeSize;
  layoutMode: "saved" | "aligned" | "staggered" | "horizontal";
  loadScreenshot?: (uri: string) => Promise<Blob>;
  loadAccessibilityTree?: (uri: string) => Promise<unknown>;
  setImageDimensions: Dispatch<SetStateAction<Map<string, ImageDimensions>>>;
  onSelectScreen: (id: string | undefined) => void;
  clearSelectedScreen: () => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  onFocusScreen: (id: string) => void;
  onRevealScreen: (id: string) => void;
  onSelectPath: (id: string | undefined) => void;
  alignedDragPosition: (
    drag: MapCanvasNodeDrag,
    event: React.PointerEvent<HTMLElement>,
  ) => { position: MapPoint; guides: AlignmentGuide[] };
  setAlignmentGuides: (guides: AlignmentGuide[]) => void;
  setDragged: (value: { id: string; position: MapPoint } | undefined) => void;
  setArrangedEdits: React.Dispatch<React.SetStateAction<Map<string, MapPoint>>>;
  onUpdateScreen?: (
    screenId: string,
    patch: { title?: string; position?: MapPoint },
  ) => Promise<void>;
  saving: boolean;
}) {
  return (
    <div
      ref={worldRef}
      data-slot="map-world"
      className="absolute inset-0 origin-top-left"
      style={{ transform: "translate3d(48px, 64px, 0) scale(1)" }}
    >
      {mapClusters(visibleScreens, visiblePaths, positions, node).map((cluster) => (
        <div
          key={cluster.id}
          aria-hidden="true"
          data-slot="map-cluster"
          className="pointer-events-none absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) rounded-(--cluster-radius) border border-brand/20 bg-brand/6"
          style={
            {
              "--box-left": `${cluster.bounds.minX}px`,
              "--box-top": `${cluster.bounds.minY}px`,
              "--box-width": `${cluster.bounds.maxX - cluster.bounds.minX}px`,
              "--box-height": `${cluster.bounds.maxY - cluster.bounds.minY}px`,
              "--cluster-radius": "48px",
            } as CSSProperties
          }
        >
          <span
            data-slot="map-cluster-label"
            className="absolute bottom-full left-6 mb-2 text-sm font-semibold whitespace-nowrap text-brand"
          >
            From {cluster.entryTitle} · {cluster.screenIds.length} screens
          </span>
        </div>
      ))}
      {alignmentGuides.map((guide, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="pointer-events-none absolute left-(--box-left) top-(--box-top) z-30 h-(--box-height) w-(--box-width) bg-info"
          style={
            {
              "--box-left": `${guide.axis === "x" ? guide.value : guide.from}px`,
              "--box-top": `${guide.axis === "x" ? guide.from : guide.value}px`,
              "--box-width": `${guide.axis === "x" ? 1 / transformRef.current.scale : guide.to - guide.from}px`,
              "--box-height": `${guide.axis === "x" ? guide.to - guide.from : 1 / transformRef.current.scale}px`,
            } as CSSProperties
          }
        />
      ))}
      <MapEdges
        horizontal={layoutMode === "horizontal"}
        selectedPathId={selectedPathId}
        onSelectPath={panningTool ? undefined : onSelectPath}
        paths={canvasMapPaths(
          originPaths.filter(
            (path) =>
              path.id === selectedPathId ||
              // Unrecorded destinations live in the inspector, avoiding overlapping terminal wires.
              (!isMapReturn(path, positions, layoutMode === "horizontal") &&
                Boolean(path.toScreenId)),
          ),
          selectedPathId,
        )}
        positions={positions}
        markerId={markerId}
        selectedScreenId={selectedScreenId}
        showInteractionTargets={showControlOrigins}
        screens={visibleScreens}
        imageDimensions={imageDimensions}
        node={node}
      />
      {visibleScreens.map((screen) => {
        const position = positions.get(screen.id) ?? { x: 0, y: 0 };
        const selectedNode = selectedScreenId === screen.id || selectedIds.has(screen.id);
        return (
          <button
            type="button"
            data-slot="map-screen"
            className="group/map-screen absolute left-(--box-left) top-(--box-top) flex h-(--box-height) w-(--box-width) flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring"
            key={screen.id}
            aria-pressed={selectedNode}
            onClick={(event) => {
              if (suppressNodeClick.current) {
                suppressNodeClick.current = false;
                return;
              }
              if (panningTool) return;
              if (event.shiftKey) {
                clearSelectedScreen();
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (next.has(screen.id)) next.delete(screen.id);
                  else next.add(screen.id);
                  return next;
                });
              } else onSelectScreen(screen.id);
            }}
            onDoubleClick={() => {
              if (!panningTool) onFocusScreen(screen.id);
            }}
            onPointerDown={(event) => {
              cancelAnimationFrame(navigationFrame.current);
              if (panningTool || !onUpdateScreen || saving || event.button !== 0) return;
              suppressNodeClick.current = false;
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              nodeDrag.current = {
                id: screen.id,
                start: { x: event.clientX, y: event.clientY },
                position,
                moved: false,
                members: new Map(
                  [...positions].filter(([id]) =>
                    selectedIds.has(screen.id) ? selectedIds.has(id) : id === screen.id,
                  ),
                ),
              };
            }}
            onPointerMove={(event) => {
              const drag = nodeDrag.current;
              if (!drag || drag.id !== screen.id) return;
              const dx = (event.clientX - drag.start.x) / transformRef.current.scale;
              const dy = (event.clientY - drag.start.y) / transformRef.current.scale;
              if (!drag.moved && Math.hypot(dx, dy) < 4) return;
              drag.moved = true;
              const aligned = alignedDragPosition(drag, event);
              setAlignmentGuides(aligned.guides);
              setDragged({ id: screen.id, position: aligned.position });
            }}
            onPointerUp={(event) => {
              const drag = nodeDrag.current;
              nodeDrag.current = undefined;
              setAlignmentGuides([]);
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (drag?.moved && onUpdateScreen) {
                suppressNodeClick.current = true;
                const position = alignedDragPosition(drag, event).position;
                const updates = [...drag.members].map(
                  ([id, origin]) =>
                    [
                      id,
                      {
                        x: origin.x + position.x - drag.position.x,
                        y: origin.y + position.y - drag.position.y,
                      },
                    ] as const,
                );
                setArrangedEdits((current) => new Map([...current, ...updates]));
                void (async () => {
                  for (const [id, position] of updates) {
                    await onUpdateScreen(id, { position });
                    drag.members.delete(id);
                  }
                })()
                  .catch(() =>
                    setArrangedEdits((current) => {
                      const next = new Map(current);
                      for (const [id, origin] of drag.members) next.set(id, origin);
                      return next;
                    }),
                  )
                  .finally(() => setDragged(undefined));
              }
            }}
            onPointerCancel={() => {
              nodeDrag.current = undefined;
              setDragged(undefined);
              setAlignmentGuides([]);
            }}
            onFocus={() => onRevealScreen(screen.id)}
            style={
              {
                "--box-left": `${position.x}px`,
                "--box-top": `${position.y}px`,
                "--box-width": `${node.width}px`,
                "--box-height": `${node.height}px`,
                "--image-height": `${node.imageHeight}px`,
              } as CSSProperties
            }
          >
            <span
              data-slot="map-screen-title"
              className={`flex h-5 w-full shrink-0 items-end justify-center text-center text-sm font-medium leading-tight ${selectedNode ? "text-brand" : "text-foreground/80"}`}
            >
              <MapFrameTitle title={screen.title} />
            </span>
            <div className="relative h-(--image-height) w-full shrink-0">
              <MapScreenPreview
                dimensions={imageDimensions.get(screen.id)}
                selected={selectedNode}
                align="top"
                framed
                uri={screen.screenshotUri}
                load={loadScreenshot}
                title={screen.title}
                onImageDimensions={(dimensions) => {
                  setImageDimensions((current) => {
                    if (
                      current.get(screen.id)?.width === dimensions.width &&
                      current.get(screen.id)?.height === dimensions.height
                    )
                      return current;
                    const next = new Map(current);
                    next.set(screen.id, dimensions);
                    return next;
                  });
                }}
              />
              {showInteractionTargets ? (
                <MapAccessibilityOverlay
                  uri={screen.accessibilityTreeUri}
                  load={loadAccessibilityTree}
                  image={imageDimensions.get(screen.id)}
                  node={node}
                />
              ) : null}
            </div>
          </button>
        );
      })}
      {visibleScreens.map((screen) => {
        const returns = visiblePaths.filter(
          (path) =>
            path.fromScreenId === screen.id &&
            isMapReturn(path, positions, layoutMode === "horizontal"),
        );
        const unexplored =
          selectedScreenId === screen.id
            ? 0
            : visiblePaths.filter((path) => path.fromScreenId === screen.id && !path.toScreenId)
                .length;
        const position = positions.get(screen.id);
        if (!position || (!returns.length && !unexplored)) return null;
        const image = containedImageRect(
          {
            x: position.x,
            y: position.y + node.titleHeight + node.gap,
            width: node.width,
            height: node.imageHeight,
          },
          imageDimensions.get(screen.id) ?? {
            width: node.width,
            height: node.imageHeight,
          },
          "top",
        );
        if (!image) return null;
        return (
          <div
            key={`returns-${screen.id}`}
            data-slot="map-screen-chips"
            className="absolute left-(--box-left) top-(--box-top) z-20 flex w-(--box-width) flex-col items-center gap-1"
            style={
              {
                "--box-left": `${position.x}px`,
                "--box-top": `${image.y + image.height + 12}px`,
                "--box-width": `${node.width}px`,
              } as CSSProperties
            }
          >
            {returns.map((path) => (
              <button
                key={path.id}
                type="button"
                aria-label={`Inspect ${path.label} to ${path.toTitle ?? "previous screen"}`}
                aria-pressed={selectedPathId === path.id}
                className="flex max-w-full items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent"
                onClick={() => {
                  onSelectPath(selectedPathId === path.id ? undefined : path.id);
                  onSelectScreen(screen.id);
                }}
              >
                <RotateCcw className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {!isRoutineReturn(path) || /^(?:disable)\b/i.test(path.label)
                    ? path.label
                    : path.toTitle
                      ? `Back to ${path.toTitle}`
                      : path.label}
                </span>
              </button>
            ))}
            {unexplored ? (
              <button
                type="button"
                className="flex max-w-full items-center gap-1 rounded-full border border-dashed border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:border-brand/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onSelectScreen(screen.id)}
              >
                <Compass className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{unexplored} not explored yet</span>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
