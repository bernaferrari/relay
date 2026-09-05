import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { highlightJson, readableJson } from "../components/run-report-formatters";
import type { RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading } from "./recording-shared";

export function RawEvidenceDisclosure({
  runId,
  runService,
  open,
  onOpenChange,
}: {
  runId: string;
  runService: RunProductService;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [copied, setCopied] = useState(false);
  const evidence = useQuery({
    queryKey: runQueryKeys.rawEvidence(runId),
    queryFn: () => runService.getRawEvidence(runId),
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <Collapsible id="raw-evidence" className="mt-4" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Audit details
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t pt-3">
        <div className="grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <p>
              Technical evidence for forensic review. It may include internal identifiers and
              captured content.
            </p>
            {evidence.data !== undefined ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (!navigator.clipboard) return;
                  try {
                    await navigator.clipboard.writeText(readableJson(evidence.data));
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1_500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            ) : null}
          </div>
          {evidence.isPending ? <PageLoading label="Loading audit details…" /> : null}
          {evidence.isError ? (
            <div
              className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm"
              role="alert"
            >
              <p>Audit details could not be loaded. The Report outcome above is unchanged.</p>
              <Button size="sm" variant="outline" onClick={() => void evidence.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}
          {evidence.data !== undefined ? (
            <ScrollArea className="max-h-[420px] overflow-auto rounded-md border border-border">
              <pre tabIndex={0} aria-label="Raw evidence JSON">
                <code>{highlightJson(readableJson(evidence.data))}</code>
              </pre>
            </ScrollArea>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
