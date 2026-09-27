import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import type { ProductTargetOption } from "../data/target-presentation";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Camera, RefreshCw } from "lucide-react";
import { SelectField } from "./filter-select";
import { MapScreenPreview } from "./map-screen-preview";

export type ScreenRefreshPreview = { token: string; screenshotUri: string; expiresAt: number };

export function MapScreenRefreshDialog({
  screen,
  loadScreenshot,
  listTargets,
  prepare,
  apply,
  onClose,
}: {
  screen: ProductMapScreen;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  listTargets(): Promise<readonly ProductTargetOption[]>;
  prepare(target: ProductTargetOption): Promise<ScreenRefreshPreview>;
  apply(preview: ScreenRefreshPreview): Promise<void>;
  onClose(): void;
}) {
  const [targetId, setTargetId] = useState("");
  const [loadedToken, setLoadedToken] = useState<string>();
  const targets = useQuery({
    queryKey: ["map-refresh-targets"],
    queryFn: listTargets,
    retry: false,
  });
  const target =
    targets.data?.find((item) => item.targetId === targetId) ??
    (targets.data?.length === 1 ? targets.data[0] : undefined);
  const capture = useMutation({ mutationFn: () => prepare(target!) });
  const save = useMutation({ mutationFn: () => apply(capture.data!), onSuccess: onClose });
  const busy = capture.isPending || save.isPending;
  const error = save.error ?? capture.error ?? targets.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader className="pr-8">
          <DialogTitle>Update {screen.title}</DialogTitle>
          <DialogDescription>
            Open this screen on your device, then update its saved appearance. Its connections stay
            in place. This is Map authoring, not a Checkpoint Capture, and does not accept a visual
            baseline.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-3">
          <SelectField
            className="min-w-0 flex-1"
            label="Device"
            placeholder={targets.isPending ? "Finding devices…" : "Choose a device"}
            disabled={busy}
            value={target?.targetId ?? ""}
            options={(targets.data ?? []).map((item) => ({
              value: item.targetId,
              label: item.name,
            }))}
            onValueChange={(value) => {
              setTargetId(value);
              capture.reset();
              save.reset();
            }}
          />
          <Button
            variant={capture.data ? "outline" : "default"}
            disabled={!target || busy}
            onClick={() => {
              save.reset();
              capture.mutate();
            }}
          >
            {capture.data ? <RefreshCw /> : <Camera />}
            {capture.isPending
              ? "Updating…"
              : capture.data
                ? "Preview again"
                : "Preview appearance"}
          </Button>
        </div>
        {targets.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect a device to update this screen.</p>
        ) : null}
        <div className="grid grid-cols-2 gap-5">
          <figure className="min-w-0 space-y-2">
            <figcaption className="text-xs text-muted-foreground">Saved screen</figcaption>
            <div className="h-[min(46vh,400px)]">
              <MapScreenPreview
                uri={screen.screenshotUri}
                load={loadScreenshot}
                title={`Saved ${screen.title}`}
              />
            </div>
          </figure>
          <figure className="min-w-0 space-y-2">
            <figcaption className="text-xs text-muted-foreground">Updated appearance</figcaption>
            <div className="flex h-[min(46vh,400px)] items-center justify-center">
              {capture.data && !capture.isPending ? (
                <MapScreenPreview
                  key={capture.data.token}
                  uri={capture.data.screenshotUri}
                  load={loadScreenshot}
                  title={`Updated ${screen.title}`}
                  onImageDimensions={() => setLoadedToken(capture.data!.token)}
                />
              ) : (
                <div
                  role="status"
                  className="grid justify-items-center gap-2 px-4 text-center text-xs text-muted-foreground"
                >
                  <Camera className="size-6" />
                  {capture.isPending
                    ? "Updating the current device appearance…"
                    : "Preview the device appearance to compare"}
                </div>
              )}
            </div>
          </figure>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : "Could not update this screen. Preview it again to retry."}
          </p>
        ) : null}
        <footer className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">Previous versions remain available.</p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!capture.data || loadedToken !== capture.data.token || busy}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Updating…" : "Update screen"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
