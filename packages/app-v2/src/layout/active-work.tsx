/** @jsxImportSource react */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  Activity,
  CircleDot,
  GitCompareArrows,
  Layers3,
  Play,
  X,
  type LucideIcon,
} from "lucide-react";
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
  change: GitCompareArrows,
};

function useActiveWorkItems(_full: boolean): {
  items: readonly ActiveWorkItem[];
  unavailable: boolean;
  retry(): Promise<void>;
} {
  const queryClient = useQueryClient();
  const { platform, productService, catalogService, changeService } = useRouteContext({
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
    enabled: _full && Boolean(recordingPointer.data),
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, "active"],
    queryFn: () => catalogService.listRuns({ view: "active" }),
    enabled: _full,
    retry: false,
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  const runPointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: 1_000,
  });
  const changes = useQuery({
    queryKey: ["changes", "active-work"],
    queryFn: () => changeService.list(),
    enabled: _full,
    staleTime: 2_000,
    refetchInterval: 3_000,
  });

  const items = useMemo(
    () =>
      collectActiveWork({
        recordingId: recordingPointer.data,
        recording: recording.data,
        runs: runs.data,
        runPointer: runPointer.data,
        changes: changes.data,
      }),
    [changes.data, recording.data, recordingPointer.data, runPointer.data, runs.data],
  );
  const unavailable = Boolean(
    recordingPointer.error || recording.error || runs.error || changes.error,
  );
  async function retry() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recording"] }),
      queryClient.invalidateQueries({ queryKey: ["run"] }),
      queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs }),
      queryClient.invalidateQueries({ queryKey: ["changes", "active-work"] }),
    ]);
  }
  return { items, unavailable, retry };
}

export function ActivityCenterButton() {
  const [open, setOpen] = useState(false);
  // Keep the global activity badge current even while the center is closed.
  const { items, unavailable, retry } = useActiveWorkItems(true);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="relay-electron-no-drag [-webkit-app-region:no-drag]"
        onClick={() => setOpen(true)}
        aria-label={`Open Activity Center${unavailable ? ", unavailable" : items.length ? `, ${items.length} active` : ""}`}
      >
        <Activity className="size-4" aria-hidden="true" />
        <span>Activity</span>
        {unavailable ? (
          <Badge variant="destructive" className="min-w-5 px-1.5">
            !
          </Badge>
        ) : items.length ? (
          <Badge variant="secondary" className="min-w-5 px-1.5 tabular-nums">
            {items.length}
          </Badge>
        ) : null}
      </Button>
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

export function ActiveWork() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { items, retry } = useActiveWorkItems(open);
  const primary = items[0];
  if (!primary) return null;
  const Icon = iconForKind[primary.kind];

  return (
    <>
      <section
        className="relay-sidebar-active-work mb-2 grid gap-1 rounded-[var(--radius-lg)] border border-[var(--border-weak-base)] bg-[var(--surface-raised-strong)] p-[9px]"
        aria-label="Active work"
      >
        <div className="relay-sidebar-active-heading flex min-h-6 items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
          <span>Active work</span>
          <Badge variant="secondary" className="min-h-5 px-1.5 text-[9px]">
            {items.length}
          </Badge>
        </div>
        <button
          type="button"
          className="relay-sidebar-active-link grid min-h-11 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-[9px] rounded-[var(--radius-md)] border-0 bg-transparent p-1.5 text-left text-[var(--text-base)]"
          onClick={() => router.history.push(primary.href)}
        >
          <Icon
            className="h-[15px] w-[15px] text-[var(--text-interactive-base)]"
            aria-hidden="true"
          />
          <span className="grid min-w-0 gap-px">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold">
              {primary.title}
            </strong>
            <small className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-[var(--text-weaker)]">
              {primary.status} · {primary.detail}
            </small>
          </span>
        </button>
        {items.length > 1 ? (
          <button
            type="button"
            className="relay-sidebar-active-all inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border-0 bg-transparent px-1.5 text-[10px] font-semibold text-[var(--text-interactive-base)]"
            onClick={() => setOpen(true)}
          >
            View all {items.length} activities
          </button>
        ) : null}
      </section>
      <ActivityCenter open={open} onOpenChange={setOpen} items={items} onRetry={retry} />
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
              In-progress recordings and Runs.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Close Activity Center">
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            }
          />
        </header>
        <ScrollArea className="min-h-0 max-h-[min(28rem,calc(100vh-12rem))]">
          {unavailable ? (
            <div className="grid gap-3 px-4 py-5" role="alert">
              <p className="text-sm text-muted-foreground">Activity is unavailable</p>
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
              <p className="text-sm text-muted-foreground">Nothing running</p>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
