import { useEffect, useState, type ImgHTMLAttributes } from "react";
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
  if (!src)
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {resource.isError ? "Screenshot could not be loaded." : "Loading screenshot…"}
      </span>
    );
  return <img {...props} src={src} />;
}
