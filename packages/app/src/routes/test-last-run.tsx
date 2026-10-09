/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { Camera, ChevronRight } from "lucide-react";
import type { ProductRunSummary } from "@relay/product/catalog";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";
import { WorkspaceScreenshot } from "../components/test-workspace";
import { StatusPill, runStateLabel, runStateOf } from "../components/run-status";
import { storyFromReport } from "../data/run-story";
import { relativeTime } from "#lib/relative-time";

export function latestRunOf(runs: readonly ProductRunSummary[] | undefined) {
  return [...(runs ?? [])].sort((left, right) => right.queuedAt - left.queuedAt)[0];
}

/** One stable-height row for every run state, including no run. */
export function TestLastRunLine({
  history,
  running = false,
}: {
  history: { data?: readonly ProductRunSummary[]; isLoading: boolean; isError: boolean };
  running?: boolean;
}) {
  const run = latestRunOf(history.data);
  const status = history.isLoading ? "loading" : history.isError ? "unavailable" : undefined;
  const search = useLocation({ select: (location) => location.search }) as Record<string, unknown>;
  if (running)
    return (
      <p className="flex h-8 w-full items-center justify-end text-sm" role="status">
        <StatusPill state="running" />
      </p>
    );
  return (
    <p className="flex h-8 w-full min-w-0 items-center justify-end gap-2 text-sm whitespace-nowrap text-muted-foreground">
      {!run && status === "loading" ? (
        <span
          role="status"
          aria-label="Loading run history"
          className="h-5 w-40 rounded-md bg-muted"
        />
      ) : !run && status === "unavailable" ? (
        <span>Run history unavailable</span>
      ) : run ? (
        // One control: the verdict, when, and where it leads (the full report).
        <Link
          className="group inline-flex h-8 min-w-0 items-center gap-2 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          to="/runs/$runId"
          params={{ runId: run.id }}
          search={{
            ...(typeof search.plan === "string" ? { plan: search.plan } : {}),
            ...(typeof search.planApp === "string" ? { planApp: search.planApp } : {}),
            ...(typeof search.app === "string" ? { app: search.app } : {}),
          }}
          aria-label={`Open report: ${runStateLabel(runStateOf(run))}, last run ${relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}`}
          title={run.targetName ? `On ${run.targetName}` : undefined}
        >
          <StatusPill state={runStateOf(run)} />
          <span className="min-w-0 truncate">
            Last run {relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
          </span>
          <ChevronRight
            className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100"
            aria-hidden="true"
          />
        </Link>
      ) : (
        <StatusPill state={runStateOf(run)} />
      )}
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
      <div
        className="flex h-full min-h-0 flex-col items-center gap-3 overflow-hidden bg-stage p-4 focus-visible:outline-2 focus-visible:outline-ring"
        role="region"
        aria-label="Latest run screenshot"
        tabIndex={0}
      >
        <WorkspaceScreenshot
          caption={<>Screenshot from latest run · {relativeTime(run.finishedAt ?? run.queuedAt)}</>}
        >
          <EvidenceImageViewer
            key={path ?? media?.src}
            frame={{
              id: path ?? media?.src ?? "latest",
              title: "Last screen of the latest run",
              media: {
                kind: "image",
                src: url,
                ...(media?.width ? { width: media.width } : {}),
                ...(media?.height ? { height: media.height } : {}),
              },
            }}
            onError={() => {}}
          />
        </WorkspaceScreenshot>
      </div>
    );
  }
  return (
    <div
      className="grid h-full min-h-0 place-items-center overflow-auto bg-stage px-6 py-5 focus-visible:outline-2 focus-visible:outline-ring"
      role="region"
      aria-label="Latest run preview"
      tabIndex={0}
    >
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
                : "Run the test and its screenshots show up here."}
          </p>
        </div>
      </div>
    </div>
  );
}
