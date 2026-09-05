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
  ArrowRight,
  CircleDot,
  FlaskConical,
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
        className="relay-electron-no-drag [-webkit-app-region:no-drag] ml-auto text-muted-foreground"
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
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b px-4 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Workspace
            </p>
            <DialogTitle className="mt-1.5">Activity</DialogTitle>
            <DialogDescription className="mt-1.5 max-w-[42ch] leading-5">
              Recording, Runs, batches, and verification continue while you move around Relay.
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
            <div className="grid gap-3 p-6" role="alert">
              <strong>Activity is unavailable</strong>
              <p className="text-sm text-muted-foreground">
                Relay could not refresh active work from the workspace.
              </p>
              <Button
                variant="outline"
                size="sm"
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
            <div className="grid gap-1 p-2">
              {items.map((item) => {
                const Icon = iconForKind[item.kind];
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    className="grid h-auto min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2 text-left whitespace-normal"
                    key={item.id}
                    onClick={() => openItem(item)}
                  >
                    <span className="grid size-8 place-items-center rounded-lg bg-muted text-foreground">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="grid min-w-0 gap-1.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant="secondary">{item.status}</Badge>
                        <small className="truncate text-xs font-normal text-muted-foreground">
                          {item.detail}
                        </small>
                      </span>
                      <strong className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </strong>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center content-center gap-2 px-6 py-8 text-center">
              <FlaskConical className="size-5 text-muted-foreground" aria-hidden="true" />
              <strong className="text-sm font-medium text-foreground">No active work</strong>
              <p className="max-w-[34ch] text-sm leading-5 text-muted-foreground">
                Start a recording, Run, or Change verification and it will stay visible here.
              </p>
            </div>
          )}
        </ScrollArea>
        <footer className="flex justify-end border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              router.history.push("/runs");
            }}
          >
            View Run history
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
