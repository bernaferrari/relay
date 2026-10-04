import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { Button } from "@relay/ui-react/components/button";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { ReportEvidenceItem } from "../data/run-report-model";

type ReportImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  media: NonNullable<ReportEvidenceItem["media"]>;
};

export function ReportImage(props: ReportImageProps) {
  return <ImageResource key={props.media.src} {...props} />;
}

function ImageResource({ media, ...props }: ReportImageProps) {
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const resource = useQuery({
    queryKey: ["report-image", media.src],
    queryFn: media.load ?? skipToken,
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
  if (decodeFailed || (!src && resource.isError))
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
          onClick={() => {
            setDecodeFailed(false);
            setAttempt((value) => value + 1);
            if (media.load) void resource.refetch();
          }}
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
  return (
    <img
      {...props}
      key={attempt}
      src={src}
      onError={(event) => {
        setDecodeFailed(true);
        props.onError?.(event);
      }}
    />
  );
}
