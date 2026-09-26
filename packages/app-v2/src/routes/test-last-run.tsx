/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Camera } from "lucide-react";
import type { ProductRunSummary } from "@relay/product/catalog";
import { DeviceFrame } from "../components/device-frame";
import { StatusPill, runStateOf } from "../components/run-status";
import { useRunThumbnail } from "../components/run-thumb";

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

/** How this Test did last time, in one line under its name. */
export function TestLastRunLine({ run }: { run?: ProductRunSummary }) {
  if (!run) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <StatusPill state="not-run" />
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <StatusPill state={runStateOf(run)} />
      <span>
        Last run {ago(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
        {run.targetName ? ` on ${run.targetName}` : ""}
      </span>
      <Link
        className="font-medium text-primary hover:underline"
        to="/runs/$runId"
        params={{ runId: run.id }}
      >
        See what happened
      </Link>
    </p>
  );
}

/** The stage shows the last run's screen until a recording frame is selected. */
export function TestLastRunStage({ run }: { run?: ProductRunSummary }) {
  const url = useRunThumbnail(run?.id);
  if (run && url) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-auto bg-stage px-6 py-6">
        <DeviceFrame src={url} alt="Last screen of the latest run" />
        <p className="text-sm text-muted-foreground">
          Last screen · {ago(run.finishedAt ?? run.queuedAt)}
        </p>
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
          <h2 className="text-base font-semibold">No screenshot yet</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Run the Test and its screenshots show up here.
          </p>
        </div>
      </div>
    </div>
  );
}
