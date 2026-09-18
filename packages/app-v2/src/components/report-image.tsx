import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import type { ReportEvidenceItem } from "../data/run-report-model";

export function ReportImage({
  media,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  media: NonNullable<ReportEvidenceItem["media"]>;
}) {
  const resource = useQuery({
    queryKey: ["report-image", media.src],
    queryFn: media.load!,
    enabled: Boolean(media.load),
    staleTime: Infinity,
  });
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!resource.data) return;
    const url = URL.createObjectURL(resource.data);
    setImage({ blob: resource.data, url });
    return () => URL.revokeObjectURL(url);
  }, [resource.data]);
  const src = media.load ? (image?.blob === resource.data ? image?.url : undefined) : media.src;
  if (!src && resource.isError)
    return (
      <span
        className="flex flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
        role="status"
      >
        Screenshot couldn’t load.
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resource.isFetching}
          onClick={() => void resource.refetch()}
        >
          {resource.isFetching ? "Loading…" : "Retry screenshot"}
        </Button>
      </span>
    );
  if (!src)
    return (
      <span className="text-xs text-muted-foreground" role="status">
        Loading screenshot…
      </span>
    );
  return <img {...props} src={src} />;
}
