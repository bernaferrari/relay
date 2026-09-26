/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { productClientForPlatform } from "../data/product-client";

/** Blob URL of a Run's last screenshot (the capture people review, else the last frame). */
export function useRunThumbnail(runId: string | undefined, enabled = true): string | undefined {
  const { platform } = useRouteContext({ from: "__root__" });
  const image = useQuery({
    queryKey: ["run-thumb", runId],
    queryFn: async () => {
      const { client } = await productClientForPlatform(platform);
      const response = await client.download(
        `/runs/${encodeURIComponent(runId!)}/thumbnail?v=content`,
      );
      if (!response.ok) return null;
      return response.blob();
    },
    enabled: Boolean(runId && enabled),
    staleTime: Infinity,
    retry: false,
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!image.data) return setUrl(undefined);
    const next = URL.createObjectURL(image.data);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image.data]);
  return url;
}

/** The last screenshot of a Run in a small device frame; loads when scrolled into view. */
export function RunThumb({ runId, label }: { runId?: string; label: string }) {
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
  const url = useRunThumbnail(runId, visible);
  return (
    <div ref={box} className="h-11 w-16 shrink-0" aria-hidden="true">
      {url ? (
        <img
          src={url}
          alt={label}
          className="size-full rounded-md border border-border bg-card object-cover object-top shadow-xs"
        />
      ) : (
        <span className="block size-full rounded-md border border-dashed border-border bg-muted/40" />
      )}
    </div>
  );
}
