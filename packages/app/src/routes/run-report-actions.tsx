/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { RawEvidenceDisclosure } from "./raw-evidence-disclosure";
import type { RunProductService } from "../data/run-product-service";
import { RunReviewControls } from "./run-review-controls";
import { RunReplayAction } from "./run-replay";
import { RunEvidenceExport, RunWalkthroughExport } from "./run-evidence-export";

type RunReport = Awaited<ReturnType<RunProductService["getReport"]>>;

export function RunReportActions({
  report,
  testId,
  runService,
  embedded,
  canInvestigate,
}: {
  report: RunReport;
  testId?: string;
  runService: RunProductService;
  embedded: boolean;
  canInvestigate: boolean;
}) {
  const [rawEvidenceOpen, setRawEvidenceOpen] = useState(false);
  const [runDialog, setRunDialog] = useState<
    "review" | "configuration" | "export" | "walkthrough" | null
  >(null);

  return (
    <>
      <Dialog open={rawEvidenceOpen} onOpenChange={setRawEvidenceOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Audit details</DialogTitle>
          <DialogDescription>Saved technical evidence for this run.</DialogDescription>
          <RawEvidenceDisclosure
            runId={report.runId}
            runService={runService}
            open={rawEvidenceOpen}
            onOpenChange={setRawEvidenceOpen}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={runDialog === "configuration"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Recorded configuration</DialogTitle>
          <DialogDescription>Environment saved with this run.</DialogDescription>
          <dl className="grid gap-x-8 gap-y-4 px-1 py-3 sm:grid-cols-2">
            {[
              ["Device", report.targetName],
              ["Account", report.executionContext?.account ?? "Not recorded"],
              ["Build", report.executionContext?.buildId],
              ["Saved setup ID", report.executionContext?.targetProfileId],
              ["Source revision", report.executionContext?.sourceRevision],
              ["Viewport", report.executionContext?.viewport],
              ["Language", report.executionContext?.locale],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            {report.executionContext?.browser ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Browser</dt>
                <dd className="mt-1 break-words font-mono text-xs">
                  {report.executionContext.browser}
                </dd>
              </div>
            ) : null}
          </dl>
        </DialogContent>
      </Dialog>
      <RunReviewControls
        runId={report.runId}
        service={runService}
        open={runDialog === "review"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      />
      <Dialog
        open={runDialog === "walkthrough"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Download walkthrough</DialogTitle>
          <DialogDescription>
            A captured-screen walkthrough you can open without Relay. Downloaded copies cannot be
            recalled.
          </DialogDescription>
          {runService.exportWalkthrough ? (
            <RunWalkthroughExport
              runId={report.runId}
              exportWalkthrough={runService.exportWalkthrough}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={runDialog === "export"}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Export evidence</DialogTitle>
          <DialogDescription>Download the saved evidence for this run.</DialogDescription>
          {runService.exportEvidence ? (
            <RunEvidenceExport runId={report.runId} exportEvidence={runService.exportEvidence} />
          ) : null}
        </DialogContent>
      </Dialog>
      {embedded ? (
        <Button
          nativeButton={false}
          render={<Link to="/runs/$runId" params={{ runId: report.runId }} />}
          variant="ghost"
          size="sm"
        >
          Review result
        </Button>
      ) : null}
      {canInvestigate ? (
        <Button
          nativeButton={false}
          render={<Link to="/debug" search={{ runId: report.runId }} />}
          variant="outline"
          title="Let an agent look into what went wrong"
        >
          Investigate
        </Button>
      ) : null}
      {!embedded && report.outcome === "harness-failure" ? (
        <RunReplayAction
          report={report}
          runService={runService}
          variant={canInvestigate ? "ghost" : "default"}
          label="Run again"
        />
      ) : testId || embedded ? null : (
        <RunReplayAction report={report} runService={runService} />
      )}
      {!embedded &&
      !report.captureReview?.items.length &&
      (runService.compareVisual || runService.review) ? (
        <Button variant="outline" size="sm" onClick={() => setRunDialog("review")}>
          Review screenshots
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
          aria-label="More run actions"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" /> More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!embedded ? (
            <DropdownMenuItem
              render={<Link to="/runs/$runId/walkthrough" params={{ runId: report.runId }} />}
            >
              Explore screens
            </DropdownMenuItem>
          ) : null}
          {!embedded && testId ? (
            <DropdownMenuItem
              render={<Link to="/tests/$testId" params={{ testId }} search={{ setup: "run" }} />}
            >
              Set up another run
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setRawEvidenceOpen(true)}>Audit</DropdownMenuItem>
          {runService.review || runService.compareVisual ? (
            <DropdownMenuItem onClick={() => setRunDialog("review")}>Review run</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setRunDialog("configuration")}>
            Configuration
          </DropdownMenuItem>
          {runService.exportWalkthrough ? (
            <DropdownMenuItem onClick={() => setRunDialog("walkthrough")}>
              Download walkthrough
            </DropdownMenuItem>
          ) : null}
          {runService.exportEvidence ? (
            <DropdownMenuItem onClick={() => setRunDialog("export")}>
              Export evidence
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
