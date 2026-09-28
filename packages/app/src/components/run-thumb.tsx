/** @jsxImportSource react */
import { ImageOff, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { productClientForPlatform } from "../data/product-client";

/** Blob URL of a Run's last screenshot (the capture people review, else the last frame). */
function useRunThumbnail(runId: string | undefined, enabled = true, available = true) {
  const { platform } = useRouteContext({ from: "__root__" });
  const image = useQuery({
    // Retire immutable thumbnails cached before origin-aware CORS responses.
    queryKey: ["run-thumb", runId, "cors-v2"],
    queryFn: async () => {
      const { client } = await productClientForPlatform(platform);
      const response = await client.download(
        `/runs/${encodeURIComponent(runId!)}/thumbnail?v=content-cors-v2`,
      );
      if (!response.ok) return null;
      return response.blob();
    },
    enabled: Boolean(runId && enabled && available),
    staleTime: Infinity,
    retry: (failureCount, error) =>
      failureCount < 1 && !("status" in error && [401, 403, 404].includes(Number(error.status))),
    retryDelay: 1_000,
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!image.data) return setUrl(undefined);
    const next = URL.createObjectURL(image.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image.data]);
  return { url, loading: available && (image.isFetching || (Boolean(runId) && !enabled)) };
}

/** The last screenshot of a Run in a small device frame; loads when scrolled into view. */
export function RunThumb({
  runId,
  label,
  available = true,
}: {
  runId?: string;
  label: string;
  available?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { url, loading } = useRunThumbnail(runId, visible, available);
  return (
    <div ref={box} className="h-11 w-16 shrink-0" aria-hidden="true">
      {url ? (
        <img
          src={url}
          alt={label}
          className="size-full rounded-md border border-border bg-card object-cover object-top shadow-xs"
        />
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-md bg-muted/40 text-muted-foreground"
          title={
            !runId
              ? "Test plan"
              : !available
                ? "Screenshot missing"
                : loading
                  ? "Loading screenshot"
                  : "No preview available"
          }
        >
          {!runId ? (
            <Layers className="size-4" />
          ) : loading ? null : (
            <ImageOff className="size-4" />
          )}
        </span>
      )}
    </div>
  );
}
