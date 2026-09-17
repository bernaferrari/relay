import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";

export function MapScreenPreview({
  uri,
  load,
  title,
  onImageDimensions,
  dimensions,
  align = "center",
  selected = false,
  thumbnail = false,
  interactive = false,
}: {
  dimensions?: { width: number; height: number };
  align?: "center" | "top";
  selected?: boolean;
  thumbnail?: boolean;
  interactive?: boolean;
  uri?: string;
  load?: (uri: string) => Promise<Blob>;
  title: string;
  onImageDimensions?: (dimensions: { width: number; height: number }) => void;
}) {
  const [loadedUrl, setLoadedUrl] = useState<string>();
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
      className={`relative flex h-full min-h-0 w-full justify-center ${align === "top" ? "items-start" : "items-center"}`}
    >
      {url ? (
        <img
          draggable={false}
          src={url}
          alt={title}
          className={`${loadedUrl === url ? "" : "invisible"} max-h-full w-auto max-w-full rounded object-contain ${thumbnail && !interactive ? "" : "outline outline-1 outline-offset-2"} ${thumbnail && !interactive ? "" : selected ? "outline-blue-400" : "outline-transparent hover:outline-blue-400/50 group-hover/map-screen:outline-blue-400/50 group-focus-visible/map-screen:outline-blue-400"}`}
          loading="lazy"
          onLoad={(event) => {
            setLoadedUrl(url);
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
      ) : uri && load && !preview.isError ? null : (
        <div className="grid justify-items-center gap-2 p-3 text-center text-xs text-muted-foreground">
          <ImageOff className={thumbnail ? "size-3.5" : "size-5"} aria-hidden="true" />
          {!thumbnail &&
            (preview.isFetching
              ? "Loading screen…"
              : preview.isError
                ? "Screenshot unavailable"
                : "No screenshot captured")}
        </div>
      )}
      {uri && load && !preview.isError && (!url || loadedUrl !== url) ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full text-[color-mix(in_oklch,var(--background),var(--foreground)_8%)]"
          viewBox={`0 0 ${dimensions?.width ?? 9} ${dimensions?.height ?? 19.5}`}
          preserveAspectRatio={align === "top" ? "xMidYMin meet" : "xMidYMid meet"}
          role="status"
          aria-label="Loading screenshot"
        >
          <rect
            width="100%"
            height="100%"
            rx={(dimensions?.width ?? 9) * 0.025}
            fill="currentColor"
          />
        </svg>
      ) : null}
    </div>
  );
}
