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
  onNavigate(stateId: string, captureId?: string): void;
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
      <figure className="relative mx-auto my-0 w-fit max-w-full overflow-hidden">
        {hotspots.length > 0 ? (
          <div className="absolute bottom-3 right-3 z-10 flex items-center rounded-lg bg-background/95 p-1 shadow-sm">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={showControls}
              onClick={() => setShowControls((value) => !value)}
            >
              <MousePointer2 className="size-4" aria-hidden="true" /> Show controls
            </Button>
            {entryStateId && entryStateId !== capture.stateId ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Return to start screen"
                onClick={() => onNavigate(entryStateId)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : null}
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
            onClick={() => onNavigate(connection.toStateId, connection.provenance?.captureId)}
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
      {hotspots.length > 0 ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Click a highlighted control to explore saved screens.
        </p>
      ) : null}
    </div>
  );
}
