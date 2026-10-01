import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import type { ScreenConsolidationPreview } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { SelectField } from "./filter-select";
import { MapScreenPreview } from "./map-screen-preview";

export function MapScreenMergeDialog({
  screen,
  screens,
  loadScreenshot,
  merge,
  onClose,
}: {
  screen: ProductMapScreen;
  screens: readonly ProductMapScreen[];
  loadScreenshot?: (uri: string) => Promise<Blob>;
  merge(sourceScreenId: string, dryRun: boolean): Promise<ScreenConsolidationPreview>;
  onClose(): void;
}) {
  const [sourceId, setSourceId] = useState("");
  const source = screens.find((item) => item.id === sourceId);
  const preview = useMutation({ mutationFn: () => merge(sourceId, true) });
  const apply = useMutation({ mutationFn: () => merge(sourceId, false), onSuccess: onClose });
  const busy = preview.isPending || apply.isPending;
  const error = apply.error ?? preview.error;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Merge captures into {screen.title}</DialogTitle>
          <DialogDescription>
            Choose another capture of this same screen, such as Home with the keyboard open.
            Captures, actions, and Test connections are kept under one screen.
          </DialogDescription>
        </DialogHeader>
        <SelectField
          label="Same screen captured separately"
          value={sourceId}
          placeholder="Choose a screen"
          disabled={busy}
          options={screens
            .filter((item) => item.id !== screen.id)
            .map((item) => ({ value: item.id, label: item.title }))}
          onValueChange={(value) => {
            setSourceId(value);
            preview.reset();
            apply.reset();
          }}
        />
        <div className="grid grid-cols-2 gap-4">
          {[screen, source].map((item, index) => (
            <div key={index} className="space-y-2">
              <p className="text-sm font-medium">{item?.title ?? "Choose a capture"}</p>
              <div className="h-48 rounded-lg bg-muted/30 p-2">
                {item ? (
                  <MapScreenPreview
                    uri={item.screenshotUri}
                    title={item.title}
                    load={loadScreenshot}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {preview.data ? (
          <div className="space-y-2 text-sm" role="status">
            <p>
              {preview.data.resultingCounts.screens} screens after merging ·{" "}
              {preview.data.rewiredConnectionIds.length} paths reconnected.
            </p>
            <p className="text-muted-foreground">
              Both captures will be available in the screen’s capture selector. Recorded actions
              stay in their original order.
            </p>
            {preview.data.blockers.map((blocker) => (
              <p key={blocker.code} className="text-destructive">
                {blocker.message}
              </p>
            ))}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {preview.data ? (
            <Button
              disabled={busy || Boolean(preview.data.blockers.length)}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? "Merging…" : "Merge screens"}
            </Button>
          ) : (
            <Button disabled={!source || busy} onClick={() => preview.mutate()}>
              {preview.isPending ? "Checking…" : "Preview merge"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
