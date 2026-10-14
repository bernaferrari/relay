/** @jsxImportSource react */
import type { ProductTestStep } from "@relay/product/catalog";
import { Button } from "@relay/ui-react/components/button";
import { ScreenshotMomentSwitch } from "./screenshot-moment-switch";
import { EvidenceImageViewer } from "./evidence-image-viewer";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Recorded evidence is explicitly distinct from the result of a later run. */
export function SavedRecordingPreview({
  frames,
  intent,
}: {
  frames: NonNullable<ProductTestStep["recordingFrames"]>;
  intent: string;
}) {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const [failedUri, setFailedUri] = useState<string>();
  const [selected, setSelected] = useState(frames.length - 1);
  const selectedIndex = Math.min(selected, frames.length - 1);
  const frame = frames[selectedIndex]!;
  const preview = useQuery({
    queryKey: ["saved-recording-frame", frame.uri],
    queryFn: () => catalogService.getRecordingFrame!(frame.uri),
    enabled: Boolean(catalogService.getRecordingFrame),
    staleTime: Infinity,
  });
  const [image, setImage] = useState<{
    data: typeof preview.data;
    url: string;
    uri: string;
    alt: string;
  }>();
  const [candidate, setCandidate] = useState<typeof image>();
  const candidateUrl = useRef<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const displayed = useRef<typeof image>(undefined);
  const requestedUri = useRef(frame.uri);
  requestedUri.current = frame.uri;
  const [showLoading, setShowLoading] = useState(false);
  const imageUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = imageUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  useEffect(() => {
    if (!preview.data) return;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(preview.data.bytes)], { type: preview.data.mime }),
    );
    imageUrls.current.add(url);
    candidateUrl.current = url;
    setCandidate({
      data: preview.data,
      url,
      uri: frame.uri,
      alt: `${frame.role === "before" ? "Before" : "After"}: ${intent}`,
    });
    return () => {
      if (displayed.current?.url !== url) {
        URL.revokeObjectURL(url);
        imageUrls.current.delete(url);
      }
    };
  }, [preview.data, frame.uri, frame.role, intent, attempt]);
  const loading =
    Boolean(catalogService.getRecordingFrame) &&
    failedUri !== frame.uri &&
    !preview.isError &&
    (preview.isPending ||
      image?.data !== preview.data ||
      image?.uri !== frame.uri ||
      (candidate?.uri === frame.uri && candidate.url !== image?.url));
  useEffect(() => {
    setShowLoading(false);
    if (!loading) return;
    const timer = setTimeout(() => setShowLoading(true), 250);
    return () => clearTimeout(timer);
  }, [loading, frame.uri]);
  const failed = preview.isError || failedUri === frame.uri || !catalogService.getRecordingFrame;
  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4" aria-label="Saved recording">
      {/* Before = where the step started, After = where it ended. A step that bundles
          several actions has screens in between; step through those, never decode numbers. */}
      {frames.length > 1 ? (
        <header className="flex shrink-0 items-center justify-end gap-2">
          {frames.length > 2 ? (
            <div className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous screen"
                disabled={selectedIndex === 0}
                onClick={() => setSelected(Math.max(0, selectedIndex - 1))}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span aria-live="polite">
                {selectedIndex + 1} of {frames.length}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next screen"
                disabled={selectedIndex === frames.length - 1}
                onClick={() => setSelected(Math.min(frames.length - 1, selectedIndex + 1))}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          <ScreenshotMomentSwitch
            label="Recording screenshots"
            value={String(selectedIndex)}
            items={[
              { value: "0", label: "Before" },
              { value: String(frames.length - 1), label: "After" },
            ]}
            onChange={(value) => setSelected(Number(value))}
          />
        </header>
      ) : null}
      <div className="relative flex min-h-0 flex-1 items-center justify-center" aria-busy={loading}>
        {candidate && !failed && candidate.uri === frame.uri && candidate.url !== image?.url ? (
          <img
            src={candidate.url}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute size-px opacity-0"
            onLoad={() => {
              if (candidate.uri !== requestedUri.current || candidate.url !== candidateUrl.current)
                return;
              if (displayed.current) {
                URL.revokeObjectURL(displayed.current.url);
                imageUrls.current.delete(displayed.current.url);
              }
              displayed.current = candidate;
              setImage(candidate);
            }}
            onError={() => {
              if (candidate.uri === requestedUri.current && candidate.url === candidateUrl.current)
                setFailedUri(candidate.uri);
            }}
          />
        ) : null}
        {image && !failed ? (
          <EvidenceImageViewer
            key={image.url}
            frame={{
              id: image.uri,
              title: image.alt,
              media: { kind: "image", src: image.url },
            }}
            onError={() => setFailedUri(image.uri)}
            className={`h-full max-h-full w-full rounded-md object-contain ${loading ? "opacity-50" : ""}`}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-muted-foreground">
            {failed ? (
              <p>This saved screenshot could not be loaded.</p>
            ) : (
              <div
                role="status"
                aria-label="Loading recorded screen"
                className="pointer-events-none aspect-[9/19.5] h-full max-w-full rounded-2xl bg-muted/30 ring-1 ring-border/40"
              />
            )}
            {catalogService.getRecordingFrame && (preview.isError || failedUri === frame.uri) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFailedUri(undefined);
                  setAttempt((value) => value + 1);
                  void preview.refetch();
                }}
              >
                Try again
              </Button>
            ) : null}
          </div>
        )}
        {showLoading && loading ? (
          <p
            role="status"
            className="pointer-events-none absolute bottom-3 rounded-full bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
          >
            Loading {frame.role === "before" ? "Before" : "After"}…
            {image ? ` Showing ${image.alt.split(":")[0]}.` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}
