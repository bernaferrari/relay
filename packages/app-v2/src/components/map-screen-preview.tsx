import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";

export function MapScreenPreview({
  uri,
  load,
  title,
}: {
  uri?: string;
  load?: (uri: string) => Promise<Blob>;
  title: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
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
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40"
    >
      {url ? (
        <img
          draggable={false}
          src={url}
          alt={title}
          className="h-full w-full object-contain"
          loading="lazy"
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
