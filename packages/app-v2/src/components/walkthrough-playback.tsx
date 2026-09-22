import { useState, type CSSProperties } from "react";
import { MousePointer2, RotateCcw } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { EvidenceImageViewer } from "./evidence-image-viewer";
import type { PlayerManifestProjection } from "../data/run-product-service";

type Capture = PlayerManifestProjection["captures"][number];
type Connection = PlayerManifestProjection["connections"][number];

/** A saved-image player: navigation never dispatches device input. */
export function WalkthroughPlayback({
  capture,
  src,
  title,
  connections,
  entryStateId,
  onNavigate,
  onError,
}: {
  capture: Capture;
  src: string;
  title: string;
  connections: readonly Connection[];
  entryStateId?: string;
  onNavigate(stateId: string): void;
  onError(): void;
}) {
  const [showControls, setShowControls] = useState(true);
  const hotspots = connections.flatMap((connection, index) => {
    if (connection.kind !== "recorded" || connection.provenance?.runId !== capture.runId) return [];
    const rect = connection.hotspot?.rect;
    const point = connection.hotspot?.point;
    const geometry = rect ?? point;
    if (
      !geometry ||
      !Number.isFinite(geometry.x) ||
      !Number.isFinite(geometry.y) ||
      geometry.x < 0 ||
      geometry.y < 0 ||
      geometry.x > 1 ||
      geometry.y > 1
    )
      return [];
    if (
      rect &&
      (!Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.x + rect.width > 1 ||
        rect.y + rect.height > 1)
    )
      return [];
    return [{ connection, index, rect, geometry }];
  });
  return (
    <div className="grid min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
        <p className="text-xs text-muted-foreground">Playback · no live device</p>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={showControls}
            onClick={() => setShowControls((value) => !value)}
            disabled={!hotspots.length}
          >
            <MousePointer2 className="size-4" aria-hidden="true" /> Show controls
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Return to start screen"
            disabled={!entryStateId || entryStateId === capture.stateId}
            onClick={() => entryStateId && onNavigate(entryStateId)}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <figure className="relative mx-auto my-0 w-fit max-w-full overflow-hidden">
        <EvidenceImageViewer
          frame={{ id: capture.id, title, media: { kind: "image", src } }}
          onError={onError}
          className="block max-h-[65dvh] w-auto max-w-full"
        />
        {hotspots.map(({ connection, index, rect, geometry }) => (
          <button
            key={`${connection.id}:${index}`}
            type="button"
            data-hotspot-index={index}
            data-recorded="true"
            aria-label={`${connection.label} — recorded link`}
            title={connection.label}
            onClick={() => onNavigate(connection.toStateId)}
            className={`absolute cursor-pointer rounded-md border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${showControls ? "border-primary bg-primary/20" : "border-transparent bg-transparent hover:border-primary hover:bg-primary/20 focus-visible:border-primary"} ${rect ? "w-(--hotspot-width) h-(--hotspot-height)" : "size-9 -translate-x-1/2 -translate-y-1/2 rounded-full"} left-(--hotspot-left) top-(--hotspot-top)`}
            style={
              {
                "--hotspot-left": `${geometry.x * 100}%`,
                "--hotspot-top": `${geometry.y * 100}%`,
                "--hotspot-width": `${(rect?.width ?? 0) * 100}%`,
                "--hotspot-height": `${(rect?.height ?? 0) * 100}%`,
              } as CSSProperties
            }
          />
        ))}
      </figure>
      <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground" role="status">
        {hotspots.length
          ? "Tap a highlighted control to follow its recorded connection. Only collected screens are available."
          : "No clickable controls were recorded on this screenshot. Explore the connected screens below."}
      </p>
    </div>
  );
}
