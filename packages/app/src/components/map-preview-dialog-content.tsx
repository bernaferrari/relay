import { DialogContent, DialogTitle } from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { MapScreenPreview } from "./map-screen-preview";

export function MapPreviewDialogContent({
  title,
  uri,
  load,
  onOpenMap,
}: {
  title: string;
  uri?: string;
  load?: (uri: string) => Promise<Blob>;
  onOpenMap(): void;
}) {
  return (
    <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
      <DialogTitle className="pr-8">{title}</DialogTitle>
      <div className="h-[min(65dvh,760px)] min-h-0">
        <MapScreenPreview uri={uri} load={load} title={title} thumbnail />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onOpenMap}>
          Open in map
        </Button>
      </div>
    </DialogContent>
  );
}
