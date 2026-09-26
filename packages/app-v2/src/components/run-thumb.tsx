/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { productClientForPlatform } from "../data/product-client";
import { DeviceFrame } from "./device-frame";

/** The last screenshot of a Run in a small device frame; loads when scrolled into view. */
export function RunThumb({ runId, label }: { runId?: string; label: string }) {
  const { platform } = useRouteContext({ from: "__root__" });
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
  const image = useQuery({
    queryKey: ["run-thumb", runId],
    queryFn: async () => {
      const { client } = await productClientForPlatform(platform);
      const response = await client.download(`/runs/${encodeURIComponent(runId!)}/thumbnail`);
      if (!response.ok) return null;
      return response.blob();
    },
    enabled: Boolean(runId && visible),
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
  return (
    <div
      ref={box}
      className="flex h-12 w-16 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {url ? (
        <DeviceFrame src={url} alt={label} size="sm" className="max-h-12 shadow-none" />
      ) : (
        <span className="h-10 w-7 rounded-md border border-dashed border-border" />
      )}
    </div>
  );
}
