/** @jsxImportSource react */
import type { ProductTestStep } from "@relay/product/catalog";
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
  const frame = frames[selected] ?? frames[0]!;
  const preview = useQuery({
    queryKey: ["saved-recording-frame", frame.uri],
    queryFn: () => catalogService.getRecordingFrame!(frame.uri),
    enabled: Boolean(catalogService.getRecordingFrame),
    staleTime: Infinity,
  });
  const [image, setImage] = useState<{ data: typeof preview.data; url: string }>();
  useEffect(() => {
    if (!preview.data) return;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(preview.data.bytes)], { type: preview.data.mime }),
    );
    setImage({ data: preview.data, url });
    return () => URL.revokeObjectURL(url);
  }, [preview.data]);
  const url = image?.data === preview.data ? image?.url : undefined;
  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4" aria-label="Saved recording">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <span className="text-sm font-medium">Recorded screen</span>
        <div className="flex gap-1" aria-label="Recording screenshots">
          {frames.map((item, index) => (
            <Button
              key={`${item.evidenceId}:${index}`}
              size="sm"
              variant="ghost"
              aria-pressed={selected === index}
              className={
                selected === index ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }
              onClick={() => setSelected(index)}
            >
              {item.role === "before" ? "Before" : "After"}
            </Button>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {url && failedUri !== frame.uri ? (
          <img
            src={url}
            onError={() => setFailedUri(frame.uri)}
            alt={`${frame.role === "before" ? "Before" : "After"}: ${intent}`}
            className="h-full max-h-full w-full rounded-md object-contain"
          />
        ) : (
          <div className="grid justify-items-center gap-3 text-sm text-muted-foreground">
            <p>
              {preview.isError || failedUri === frame.uri || !catalogService.getRecordingFrame
                ? "This saved screenshot could not be loaded."
                : "Loading recorded screen…"}
            </p>
            {preview.isError ? (
              <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
                Try again
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <p className="shrink-0 text-xs text-muted-foreground">
        Captured while recording. Run the test to see a new result.
      </p>
    </section>
  );
}
