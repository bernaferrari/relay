import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";

export function MapScreenPreview({
  uri,
  load,
  title,
  onImageDimensions,
  align = "center",
  selected = false,
}: {
  align?: "center" | "top";
  selected?: boolean;
  uri?: string;
  load?: (uri: string) => Promise<Blob>;
  title: string;
  onImageDimensions?: (dimensions: { width: number; height: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  const reportedDimensions = useRef<{ width: number; height: number } | undefined>(undefined);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: "200px" },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const preview = useQuery({
    queryKey: ["map-screen-preview", uri],
    queryFn: () => load!(uri!),
    enabled: Boolean(visible && uri && load),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!preview.data) {
      setImage(undefined);
      return;
    }
    const next = URL.createObjectURL(preview.data);
    setImage({ blob: preview.data, url: next });
    return () => URL.revokeObjectURL(next);
  }, [preview.data]);
  const url = image?.blob === preview.data ? image?.url : undefined;
  return (
    <div
      ref={container}
      className={`flex h-full min-h-0 w-full justify-center ${align === "top" ? "items-start" : "items-center"}`}
    >
      {url ? (
        <img
          draggable={false}
          src={url}
          alt={title}
          className={`max-h-full w-auto max-w-full rounded-[4px] object-contain outline outline-1 outline-offset-2 ${selected ? "outline-blue-400" : "outline-transparent group-hover/map-screen:outline-blue-400/50 group-focus-visible/map-screen:outline-blue-400"}`}
          loading="lazy"
          onLoad={(event) => {
            const dimensions = {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            };
            if (
              reportedDimensions.current?.width === dimensions.width &&
              reportedDimensions.current?.height === dimensions.height
            )
              return;
            reportedDimensions.current = dimensions;
            onImageDimensions?.(dimensions);
          }}
        />
      ) : uri && load && !preview.isError ? (
        <div
          className="h-full w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          role="status"
          aria-label="Loading screenshot"
        />
      ) : (
        <div className="grid justify-items-center gap-2 p-3 text-center text-xs text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          {preview.isFetching
            ? "Loading screen…"
            : preview.isError
              ? "Screenshot unavailable"
              : "No screenshot captured"}
        </div>
      )}
    </div>
  );
}
