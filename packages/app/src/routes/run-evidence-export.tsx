/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RunEvidenceExportDocument } from "@relay/product/run-evidence-export";
import { productLinkClassName } from "../lib/class-names";

function exportProblem(error: unknown): string {
  if (!(error instanceof Error)) return "Relay could not export this Run. Try again.";
  if (error.name === "TimeoutError" || /\bsignal timed out\b/iu.test(error.message)) {
    return "Evidence export timed out. Try again.";
  }
  if (error.name === "AbortError") return "Evidence export was interrupted. Try again.";
  if (/failed to fetch|networkerror|network request failed/iu.test(error.message)) {
    return "Could not reach Relay. Check the connection and try again.";
  }
  return error.message || "Relay could not export this Run. Try again.";
}

function RunEvidenceExportForRun({
  runId,
  exportEvidence,
  kind = "evidence",
}: {
  runId: string;
  exportEvidence(runId: string): Promise<RunEvidenceExportDocument>;
  kind?: "evidence" | "walkthrough";
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [href, setHref] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const exportRun = useMutation({
    mutationFn: () => exportEvidence(runId),
    onMutate: () => {
      setHref(undefined);
      setFileName(undefined);
    },
    onSuccess: (document) => {
      if (!mounted.current) return;
      setHref(
        URL.createObjectURL(
          new Blob([document.body], {
            type: kind === "walkthrough" ? "text/html" : "application/json",
          }),
        ),
      );
      setFileName(document.fileName);
    },
  });
  useEffect(
    () => () => {
      if (href) URL.revokeObjectURL(href);
    },
    [href],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => exportRun.mutate()}
        disabled={exportRun.isPending}
      >
        {exportRun.isPending
          ? "Preparing…"
          : exportRun.isError
            ? "Try again"
            : kind === "walkthrough"
              ? "Prepare walkthrough"
              : "Export evidence"}
      </Button>
      {href && fileName ? (
        <a className={productLinkClassName} href={href} download={fileName}>
          {kind === "walkthrough" ? "Save walkthrough" : "Save evidence pack"}
        </a>
      ) : null}
      {exportRun.error ? (
        <p className="text-sm text-destructive" role="status">
          {exportProblem(exportRun.error)}
        </p>
      ) : null}
    </div>
  );
}

/** A download belongs to one Run, including requests that finish after navigation. */
export function RunEvidenceExport(props: {
  runId: string;
  exportEvidence(runId: string): Promise<RunEvidenceExportDocument>;
}) {
  return <RunEvidenceExportForRun key={props.runId} {...props} />;
}

export function RunWalkthroughExport(props: {
  runId: string;
  exportWalkthrough(runId: string): Promise<RunEvidenceExportDocument>;
}) {
  return (
    <RunEvidenceExportForRun
      key={props.runId}
      runId={props.runId}
      exportEvidence={props.exportWalkthrough}
      kind="walkthrough"
    />
  );
}
