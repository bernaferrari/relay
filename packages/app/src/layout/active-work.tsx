/** @jsxImportSource react */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Button } from "@relay/ui-react/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { CircleDot, Layers3, Play, X, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { collectActiveWork, type ActiveWorkItem, type ActiveWorkKind } from "../data/active-work";
import { catalogQueryKeys } from "../data/catalog-queries";
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";

const iconForKind: Record<ActiveWorkKind, LucideIcon> = {
  recording: CircleDot,
  run: Play,
  batch: Layers3,
};

function useActiveWorkItems(): {
  items: readonly ActiveWorkItem[];
  unavailable: boolean;
  retry(): Promise<void>;
} {
  const queryClient = useQueryClient();
  const { platform, productService, catalogService } = useRouteContext({
    from: "__root__",
  });
  const recordingPointer = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: 1_000,
  });
  const recording = useQuery({
    queryKey: recordingQueryKeys.workflow(recordingPointer.data ?? "unselected"),
    queryFn: () => productService.inspect(recordingPointer.data!),
    enabled: Boolean(recordingPointer.data),
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, "active"],
    queryFn: () => catalogService.listRuns({ view: "active" }),
    retry: false,
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  const runPointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: 1_000,
  });

  const items = useMemo(
    () =>
      collectActiveWork({
        recordingId: recordingPointer.data,
        recording: recording.data,
        runs: runs.data,
        runPointer: runPointer.data,
      }),
    [recording.data, recordingPointer.data, runPointer.data, runs.data],
  );
  const unavailable = Boolean(recordingPointer.error || recording.error || runs.error);
  async function retry() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recording"] }),
      queryClient.invalidateQueries({ queryKey: ["run"] }),
      queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs }),
    ]);
  }
  return { items, unavailable, retry };
}

/**
 * Keep running work and resumable drafts discoverable without animating idle reviews.
 */
export function ActivityCenterButton() {
  const [open, setOpen] = useState(false);
  // Keep the global indicator current even while the center is closed.
  const { items, unavailable, retry } = useActiveWorkItems();
  const count = (activity: ActiveWorkItem["activity"]) =>
    items.filter((item) => item.activity === activity).length;
  const running = count("running");
  const drafts = count("draft");
  const queued = count("queued");
  const unknown = count("unknown");
  const label = [
    running ? `${running} running` : "",
    queued ? `${queued} queued` : "",
    drafts ? `${drafts} ${drafts === 1 ? "draft" : "drafts"}` : "",
    unknown ? `${unknown} to check` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (!unavailable && !items.length && !open) return null;
  return (
    <>
      {unavailable || items.length ? (
        <Button
          variant="outline"
          size="sm"
          className="[-webkit-app-region:no-drag]"
          onClick={() => setOpen(true)}
          title={unavailable ? "Couldn’t check activity" : "Open activity"}
          aria-label={`Open activity${unavailable ? ", unavailable" : `, ${label}`}`}
        >
          {unavailable ? (
            <span className="size-2 rounded-full bg-destructive" aria-hidden="true" />
          ) : (
            <span className="relative flex size-2" aria-hidden="true">
              {running > 0 ? (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:hidden" />
              ) : null}
              <span
                className={`relative inline-flex size-2 rounded-full ${running > 0 ? "bg-brand" : "bg-muted-foreground"}`}
              />
            </span>
          )}
          <span className="tabular-nums">{unavailable ? "Activity unavailable" : label}</span>
        </Button>
      ) : null}
      <ActivityCenter
        open={open}
        onOpenChange={setOpen}
        items={items}
        unavailable={unavailable}
        onRetry={retry}
      />
    </>
  );
}

function ActivityCenter({
  open,
  onOpenChange,
  items,
  unavailable,
  onRetry,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: readonly ActiveWorkItem[];
  unavailable?: boolean;
  onRetry?(): Promise<void>;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  function openItem(item: ActiveWorkItem) {
    onOpenChange(false);
    router.history.push(item.href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(38rem,calc(100vh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription className="sr-only">
              Running work and saved recording drafts.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Close activity">
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            }
          />
        </header>
        <ScrollArea className="min-h-0 max-h-[min(28rem,calc(100vh-12rem))]">
          {unavailable ? (
            <div className="grid gap-3 px-4 py-5" role="alert">
              <p className="text-sm text-muted-foreground">Couldn’t load activity</p>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={retrying || !onRetry}
                onClick={() => {
                  if (!onRetry) return;
                  setRetrying(true);
                  void onRetry().finally(() => setRetrying(false));
                }}
              >
                {retrying ? "Refreshing…" : "Try again"}
              </Button>
            </div>
          ) : items.length ? (
            <div className="grid gap-0.5 px-2 pb-2">
              {items.map((item) => {
                const Icon = iconForKind[item.kind];
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-12 w-full text-left whitespace-normal"
                    key={item.id}
                    onClick={() => openItem(item)}
                  >
                    <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-3 px-2.5 py-2">
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      <span className="grid min-w-0">
                        <strong className="truncate text-sm font-medium text-foreground">
                          {item.title}
                        </strong>
                        <small className="truncate text-xs font-normal text-muted-foreground">
                          {item.status}
                        </small>
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6">
              <p className="text-sm text-muted-foreground">No active work or drafts</p>
            </div>
          )}
        </ScrollArea>
        <footer className="border-t border-border px-4 py-3">
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            render={<Link to="/sessions" />}
            onClick={() => onOpenChange(false)}
          >
            View all activity
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
