/** @jsxImportSource react */
import { Badge } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { CircleDot, Play } from "lucide-react";
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";

export function ActiveWork() {
  const { platform } = useRouteContext({ from: "__root__" });
  const recording = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const run = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });

  if (!recording.data && !run.data) return null;

  return (
    <section className="relay-sidebar-active-work" aria-label="Active work">
      <div className="relay-sidebar-active-heading">
        <span>Active work</span>
        <Badge variant="secondary">Live</Badge>
      </div>
      {recording.data ? (
        <Link
          className="relay-sidebar-active-link"
          to="/tests/$testId/record"
          params={{ testId: recording.data }}
        >
          <CircleDot aria-hidden="true" />
          <span>
            <strong>Recording in progress</strong>
            <small>Continue where you left off</small>
          </span>
        </Link>
      ) : null}
      {run.data ? (
        <Link
          className="relay-sidebar-active-link"
          to="/runs/$runId"
          params={{ runId: run.data.runId }}
        >
          <Play aria-hidden="true" />
          <span>
            <strong>Run in progress</strong>
            <small>View live status</small>
          </span>
        </Link>
      ) : null}
    </section>
  );
}
