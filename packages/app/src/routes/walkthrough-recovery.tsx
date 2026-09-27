import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import type { PlayerManifestProjection, RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { RunReplayAction } from "./run-replay";

/** Load setup only on request; reading a walkthrough never starts or restores a target. */
export function WalkthroughRecovery({
  manifest,
  variantId,
  runService,
}: {
  manifest: PlayerManifestProjection;
  variantId?: string;
  runService: RunProductService;
}) {
  const [requested, setRequested] = useState(false);
  const source = manifest.captures
    .filter((capture) => capture.variantId === variantId)
    .reduce<PlayerManifestProjection["captures"][number] | undefined>(
      (latest, capture) => (!latest || capture.capturedAt > latest.capturedAt ? capture : latest),
      undefined,
    );
  const report = useQuery({
    queryKey: runQueryKeys.report(source?.runId ?? "unavailable"),
    queryFn: () => runService.getReport(source!.runId),
    enabled: requested && Boolean(source),
    retry: false,
  });
  if (!source)
    return (
      <p className="text-sm text-muted-foreground">
        No saved run is available for this configuration.
      </p>
    );
  if (!runService.replay || !runService.getReplayJob) return null;
  if (requested && report.data)
    return (
      <RunReplayAction
        report={report.data}
        runService={runService}
        label="Set up another run"
        setupOnMount
      />
    );
  return (
    <div className="grid justify-items-center gap-2">
      <Button
        variant="outline"
        disabled={requested && report.isFetching}
        onClick={() => {
          if (requested) void report.refetch();
          else setRequested(true);
        }}
      >
        {requested && report.isFetching
          ? "Loading run setup…"
          : report.isError
            ? "Retry run setup"
            : "Set up another run"}
      </Button>
      {report.isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Could not load the saved setup. Try again or inspect the run.
        </p>
      ) : null}
    </div>
  );
}
