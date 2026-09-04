/** @jsxImportSource react */
import { Badge, Button, Dialog, IconButton, ScrollArea } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  Activity,
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

function useActiveWorkItems(full: boolean): readonly ActiveWorkItem[] {
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
    enabled: full && Boolean(recordingPointer.data),
    staleTime: 2_000,
    refetchInterval: 3_000,
  });
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, "active"],
    queryFn: () => catalogService.listRuns({ view: "active" }),
    enabled: full,
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
    enabled: full,
    staleTime: 2_000,
    refetchInterval: 3_000,
  });

  return useMemo(
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
}

export function ActivityCenterButton() {
  const [open, setOpen] = useState(false);
  const items = useActiveWorkItems(open);
  return (
    <>
      <button
        type="button"
        className="relay-activity-trigger relay-electron-no-drag"
        onClick={() => setOpen(true)}
        aria-label={`Open Activity Center${items.length ? `, ${items.length} active` : ""}`}
      >
        <Activity aria-hidden="true" />
        <span>Activity</span>
        {items.length ? <Badge variant="secondary">{items.length}</Badge> : null}
      </button>
      <ActivityCenter open={open} onOpenChange={setOpen} items={items} />
    </>
  );
}

export function ActiveWork() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const items = useActiveWorkItems(open);
  const primary = items[0];
  if (!primary) return null;
  const Icon = iconForKind[primary.kind];

  return (
    <>
      <section className="relay-sidebar-active-work" aria-label="Active work">
        <div className="relay-sidebar-active-heading">
          <span>Active work</span>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
        <button
          type="button"
          className="relay-sidebar-active-link"
          onClick={() => router.history.push(primary.href)}
        >
          <Icon aria-hidden="true" />
          <span>
            <strong>{primary.title}</strong>
            <small>
              {primary.status} · {primary.detail}
            </small>
          </span>
        </button>
        {items.length > 1 ? (
          <button type="button" className="relay-sidebar-active-all" onClick={() => setOpen(true)}>
            View all {items.length} activities
          </button>
        ) : null}
      </section>
      <ActivityCenter open={open} onOpenChange={setOpen} items={items} />
    </>
  );
}

function ActivityCenter({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: readonly ActiveWorkItem[];
}) {
  const router = useRouter();
  function openItem(item: ActiveWorkItem) {
    onOpenChange(false);
    router.history.push(item.href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop relay-activity-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport relay-activity-viewport">
          <Dialog.Popup className="relay-overlay-popup relay-activity-center">
            <header className="relay-activity-header">
              <div>
                <p className="relay-section-label">Workspace</p>
                <Dialog.Title>Activity Center</Dialog.Title>
                <Dialog.Description className="relay-activity-description">
                  Recording, Runs, batches, and verification continue while you move around Relay.
                </Dialog.Description>
              </div>
              <Dialog.Close
                render={
                  <IconButton size="small" aria-label="Close Activity Center">
                    <X aria-hidden="true" />
                  </IconButton>
                }
              />
            </header>
            <ScrollArea className="relay-activity-list">
              {items.length ? (
                <div>
                  {items.map((item) => {
                    const Icon = iconForKind[item.kind];
                    return (
                      <button
                        type="button"
                        className="relay-activity-item"
                        key={item.id}
                        onClick={() => openItem(item)}
                      >
                        <span className={`relay-activity-icon relay-activity-icon--${item.kind}`}>
                          <Icon aria-hidden="true" />
                        </span>
                        <span className="relay-activity-copy">
                          <span>
                            <Badge variant="secondary">{item.status}</Badge>
                            <small>{item.detail}</small>
                          </span>
                          <strong>{item.title}</strong>
                        </span>
                        <span className="relay-activity-open">Open</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="relay-activity-empty">
                  <FlaskConical aria-hidden="true" />
                  <strong>No active work</strong>
                  <p>
                    Start a recording, Run, or Change verification and it will stay visible here.
                  </p>
                </div>
              )}
            </ScrollArea>
            <footer className="relay-activity-footer">
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  onOpenChange(false);
                  router.history.push("/runs");
                }}
              >
                View Run history
              </Button>
            </footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
