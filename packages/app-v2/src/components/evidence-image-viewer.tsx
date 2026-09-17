import { ReportImage } from "./report-image";
/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { Expand, Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { ReportEvidenceItem } from "../data/run-product-service";

/** Opens the exact saved frame. Scaling never substitutes another step's image. */
export function EvidenceImageViewer({
  frame,
  onError,
  className,
}: {
  frame: ReportEvidenceItem;
  onError(): void;
  className?: string;
}) {
  const [zoom, setZoom] = useState(0);
  const [open, setOpen] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ src: string; width: number }>();
  if (!frame.media) return null;
  const imageWidth =
    frame.media.width ?? (naturalSize?.src === frame.media.src ? naturalSize.width : undefined);
  return (
    <>
      <ReportImage
        media={frame.media}
        alt={frame.title}
        width={frame.media.width}
        height={frame.media.height}
        className={className ?? "max-h-[28rem] w-full max-w-full object-contain"}
        onError={onError}
        onLoad={(event) =>
          setNaturalSize({ src: frame.media!.src, width: event.currentTarget.naturalWidth })
        }
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setZoom(0);
        }}
      >
        <DialogTrigger
          render={
            <Button
              className="absolute right-3 top-3 bg-background/70 text-muted-foreground hover:text-foreground"
              variant="ghost"
              size="icon-sm"
              aria-label="Inspect screenshot"
              title="Inspect screenshot"
            >
              <Expand aria-hidden="true" />
            </Button>
          }
        />
        <DialogContent className="flex h-[92dvh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border py-4 pr-14 pl-5">
            <div className="min-w-0">
              <DialogTitle className="text-sm">{frame.title}</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                Saved screenshot · zoom in to inspect details
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1" aria-label="Screenshot zoom">
              <Button
                size="sm"
                variant={zoom === 0 ? "secondary" : "ghost"}
                onClick={() => setZoom(0)}
              >
                Fit
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom out"
                disabled={zoom === 0}
                onClick={() => setZoom((value) => Math.max(0, value - 1))}
              >
                <Minus aria-hidden="true" />
              </Button>
              <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">
                {zoom === 0 ? "Fit" : `${zoom * 100}%`}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom in"
                disabled={zoom === 4 || !imageWidth}
                onClick={() => setZoom((value) => Math.min(4, value + 1))}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
          </header>
          <div
            className={`min-h-0 flex-1 overflow-auto bg-muted/20 p-4 ${zoom === 0 ? "flex items-center justify-center" : ""}`}
            tabIndex={0}
            role="region"
            aria-label="Screenshot inspection area"
          >
            <ReportImage
              media={frame.media}
              alt={frame.title}
              width={frame.media.width}
              height={frame.media.height}
              className={zoom === 0 ? "max-h-full max-w-full object-contain" : "max-w-none"}
              style={zoom ? { width: imageWidth! * zoom } : undefined}
              onError={onError}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
