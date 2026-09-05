/** @jsxImportSource react */
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProductRunReportOverview, RunProductService } from "../data/run-product-service";

const routeApi = getRouteApi("/runs/$runId");

type RunReport = ProductRunReportOverview;

export function RunReplayAction({
  report,
  runService,
}: {
  report: RunReport;
  runService: RunProductService;
}) {
  const search = routeApi.useSearch() as { replayJob?: unknown };
  const replayJobId = typeof search.replayJob === "string" ? search.replayJob : "";
  const [open, setOpen] = useState(false);
  const navigate = useNavigate({ from: "/runs/$runId" });
  const replay = useMutation({
    mutationFn: async () => {
      if (!runService.replay) throw new Error("Exact replay is unavailable in this Relay host.");
      return runService.replay(report.runId);
    },
    onSuccess: async (result) => {
      await navigate({ search: (previous) => ({ ...previous, replayJob: result.jobId }) });
      setOpen(false);
    },
  });
  if (!runService.replay || !runService.getReplayJob || replayJobId) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!replay.isPending) setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>Replay saved steps</DialogTrigger>
      <DialogContent showCloseButton={!replay.isPending}>
        <DialogTitle>Replay saved steps</DialogTitle>
        <DialogDescription>
          Run the recorded steps and saved inputs on {report.targetName ?? "the original target"}.
          Relay checks the saved target and browser profile before starting.
        </DialogDescription>
        <p className="text-sm text-muted-foreground">
          The installed app or build stays as it is now. Replay does not restore an older build.
          Unavailable private inputs must be supplied through a new run setup.
        </p>
        {replay.error ? (
          <p role="alert">
            {replay.error instanceof Error ? replay.error.message : "Replay could not start."}
          </p>
        ) : null}
        <div className="relay-dialog-actions">
          <DialogClose
            render={
              <Button variant="ghost" disabled={replay.isPending}>
                Cancel
              </Button>
            }
          />
          <Button onClick={() => replay.mutate()} disabled={replay.isPending}>
            {replay.isPending ? "Starting replay…" : "Start replay"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RunReplayStatus({ runService }: { runService: RunProductService }) {
  const search = routeApi.useSearch() as { replayJob?: unknown };
  const replayJobId = typeof search.replayJob === "string" ? search.replayJob : "";
  const navigate = useNavigate({ from: "/runs/$runId" });
  const replayJob = useQuery({
    queryKey: ["run-replay-job", replayJobId],
    queryFn: () => {
      if (!runService.getReplayJob)
        throw new Error(
          "This host cannot follow this replay. Open Run history to find its result.",
        );
      return runService.getReplayJob(replayJobId);
    },
    enabled: Boolean(replayJobId),
    retry: false,
    refetchInterval: (query) =>
      query.state.error ||
      (query.state.data && !["queued", "running", "paused"].includes(query.state.data.status))
        ? false
        : 1_500,
  });
  const replayTerminal = Boolean(
    replayJob.data && ["ok", "error", "healed", "cancelled"].includes(replayJob.data.status),
  );
  const stopReplay = useMutation({
    mutationFn: async () => {
      if (!runService.cancelReplay) throw new Error("Stopping replay is unavailable in this host.");
      await runService.cancelReplay(replayJobId);
    },
    onSuccess: async () => {
      await replayJob.refetch();
    },
  });
  useEffect(() => {
    const runId = replayJob.data?.runId;
    if (!runId || !replayTerminal) return;
    void navigate({ to: "/runs/$runId", params: { runId }, search: {} });
  }, [navigate, replayJob.data?.runId, replayTerminal]);
  if (!replayJobId) return null;
  if (replayJob.error)
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert />
        <AlertTitle>Could not check replay progress</AlertTitle>
        <AlertDescription>{replayJob.error.message}</AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void replayJob.refetch()}
            disabled={replayJob.isFetching}
          >
            Try again
          </Button>
        </AlertAction>
      </Alert>
    );
  if (
    replayJob.data &&
    !["queued", "running", "paused"].includes(replayJob.data.status) &&
    (!replayJob.data.runId || !replayTerminal)
  )
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert />
        <AlertTitle>
          {replayJob.data.status === "cancelled"
            ? "Replay cancelled"
            : replayJob.data.status === "error"
              ? "Replay failed"
              : "Replay report unavailable"}
        </AlertTitle>
        <AlertDescription>
          {replayJob.data.error ??
            "No saved report is available for this replay. Check Run history for the latest result."}
        </AlertDescription>
        <AlertAction>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({ search: (previous) => ({ ...previous, replayJob: undefined }) })
            }
          >
            Dismiss
          </Button>
        </AlertAction>
      </Alert>
    );
  return (
    <div className="relay-report-note flex flex-wrap items-center justify-between gap-3">
      <p role="status">
        {replayJob.data?.status === "paused"
          ? "Replay paused; waiting for the current operation to continue."
          : replayJob.data?.status === "queued"
            ? "Replay queued on the saved target…"
            : "Replaying saved steps on the saved target…"}
      </p>
      {runService.cancelReplay ? (
        <Button
          variant="outline"
          size="sm"
          disabled={stopReplay.isPending}
          onClick={() => stopReplay.mutate()}
        >
          {stopReplay.isPending ? "Stopping…" : "Stop replay"}
        </Button>
      ) : null}
      {stopReplay.error ? (
        <p role="alert">Could not stop the replay. {stopReplay.error.message}</p>
      ) : null}
    </div>
  );
}
