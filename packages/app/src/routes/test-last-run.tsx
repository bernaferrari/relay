/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { Camera } from "lucide-react";
import type { ProductRunSummary } from "@relay/product/catalog";
import { WorkspaceScreenshot } from "../components/test-workspace";
import { StatusPill, runStateOf } from "../components/run-status";
import { storyFromReport } from "../data/run-story";

function ago(value?: number): string {
  if (!value) return "";
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function latestRunOf(runs: readonly ProductRunSummary[] | undefined) {
  return [...(runs ?? [])].sort((left, right) => right.queuedAt - left.queuedAt)[0];
}

/** One stable-height row for every run state, including no run. */
export function TestLastRunLine({ run }: { run?: ProductRunSummary }) {
  const search = useLocation({ select: (location) => location.search }) as Record<string, unknown>;
  return (
    <p className="flex h-8 w-full min-w-0 items-center justify-end gap-2 text-sm whitespace-nowrap text-muted-foreground">
      <StatusPill state={runStateOf(run)} />
      {run ? (
        <>
          <span
            className="min-w-0 truncate"
            title={`Last run ${ago(run.finishedAt ?? run.startedAt ?? run.queuedAt)}${run.targetName ? ` on ${run.targetName}` : ""}`}
          >
            Last run {ago(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
            {run.targetName ? ` on ${run.targetName}` : ""}
          </span>
          <Link
            className="inline-flex h-8 shrink-0 items-center rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            to="/runs/$runId"
            params={{ runId: run.id }}
            search={{
              ...(typeof search.plan === "string" ? { plan: search.plan } : {}),
              ...(typeof search.planApp === "string" ? { planApp: search.planApp } : {}),
              ...(typeof search.app === "string" ? { app: search.app } : {}),
            }}
          >
            See what happened
          </Link>
        </>
      ) : null}
    </p>
  );
}

/** The stage shows the last run's screen until a recording frame is selected. */
export function TestLastRunStage({ run }: { run?: ProductRunSummary }) {
  const { runService } = useRouteContext({ from: "__root__" });
  const report = useQuery({
    queryKey: ["catalog", "run-report", run?.id ?? "none"],
    queryFn: () => runService.getReport(run!.id),
    enabled: Boolean(run),
    staleTime: 30_000,
    retry: false,
  });
  const data = report.data;
  const path = data
    ? storyFromReport({
        timeline: data.traceSteps?.length ? data.traceSteps : data.timeline,
        ...(data.stepEvidence ? { stepEvidence: data.stepEvidence } : {}),
      })
        .flatMap((step) => step.actions)
        .filter((action) => action.framePath)
        .at(-1)?.framePath
    : undefined;
  const screenshots = data?.evidence
    .filter((section) => section.id === "screenshot")
    .flatMap((section) => section.items)
    .filter((item) => item.media);
  const media = (path ? screenshots?.find((item) => item.id === path) : screenshots?.at(-1))?.media;
  const direct = media?.load ? undefined : media?.src;
  const frame = useQuery({
    queryKey: ["test-preview", "frame", run?.id, path ?? media?.src],
    queryFn: () => (media?.load ? media.load() : runService.loadFrame!(run!.id, path!)),
    enabled: Boolean(run && !direct && (media?.load || (path && runService.loadFrame))),
    staleTime: Infinity,
    retry: 1,
  });
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (!frame.data) return setBlobUrl(undefined);
    const next = URL.createObjectURL(frame.data);
    setBlobUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [frame.data]);
  const url = direct ?? blobUrl;
  const loading = Boolean(run) && (report.isLoading || frame.isLoading);
  const failed = report.isError || frame.isError;
  if (run && url) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-start gap-3 overflow-auto bg-stage px-6 py-6">
        <WorkspaceScreenshot
          caption={<>Screenshot from latest run · {ago(run.finishedAt ?? run.queuedAt)}</>}
        >
          <img src={url} alt="Last screen of the latest run" draggable={false} />
        </WorkspaceScreenshot>
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-0 place-items-center overflow-auto bg-stage px-6 py-5">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-card shadow-xs">
          <Camera className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="grid gap-1.5">
          <h2 className="text-base font-semibold">
            {loading
              ? "Loading screenshot…"
              : failed
                ? "Screenshot unavailable"
                : "No screenshot yet"}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {loading
              ? "Opening the original capture."
              : failed
                ? "Open Result to inspect the run’s evidence."
                : "Run the Test and its screenshots show up here."}
          </p>
        </div>
      </div>
    </div>
  );
}
