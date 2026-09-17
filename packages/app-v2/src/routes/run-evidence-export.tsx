/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { RunEvidenceExportDocument } from "@relay/product/run-evidence-export";

export function RunEvidenceExport({
  runId,
  exportEvidence,
}: {
  runId: string;
  exportEvidence(runId: string): Promise<RunEvidenceExportDocument>;
}) {
  const [href, setHref] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const exportRun = useMutation({
    mutationFn: () => exportEvidence(runId),
    onSuccess: (document) => {
      if (href) URL.revokeObjectURL(href);
      setHref(URL.createObjectURL(new Blob([document.body], { type: "application/json" })));
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
        {exportRun.isPending ? "Preparing…" : "Export evidence"}
      </Button>
      {href && fileName ? (
        <a
          className="{productLinkClassName}"
          href={href}
          download={fileName}
        >
          Save evidence pack
        </a>
      ) : null}
      {exportRun.error ? (
        <p className="text-sm text-destructive" role="status">
          {exportRun.error instanceof Error
            ? exportRun.error.message
            : "Relay could not export this Run."}
        </p>
      ) : null}
    </div>
  );
}
