import { BatchReviewWorkspace } from "./batch-review-workspace";
/** @jsxImportSource react */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@relay/ui-react/components/tabs";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useRouteContext } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import {
  batchReviewNotesKey,
  parseBatchReviewNotes,
  appendBatchReviewNote,
  type BatchReviewNote,
} from "../data/batch-review-notes";
import {
  batchRerunRequest,
  batchTriageKeyboardCommand,
  batchTriageMutation,
  isBatchCaseRerunnable,
  resolveTriageActor,
  selectedClusterCaseIds,
} from "./batch-triage";
import { BatchTriageControls } from "./batch-triage-controls";
import { BatchFailureClusters, BatchResultMatrix } from "./batch-triage-panels";
import {
  BatchFindingsLead,
  BatchFindingsPanel,
  BatchResultSummary,
  BatchStabilityPanel,
} from "./batch-plan-review";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { resolvePlanFindings } from "./batch-finding-review";
import { PlanCaptureReviewSection } from "./batch-capture-review";
import { productLinkClassName } from "../lib/class-names";
import {
  flakyTestIdsFromStability,
  stabilitySamplesFromBatch,
  stabilitySamplesFromRuns,
  summarizeProductStability,
} from "../data/stability-product-service";

const routeApi = getRouteApi("/batches/$batchId");

export function BatchPage() {
  const { runAcrossService, queryClient, platform, catalogService } = useRouteContext({
    from: "__root__",
  });
  const { batchId } = routeApi.useParams();
  const [resultView, setResultView] = useState(
    runAcrossService.getCaptureReview ? "screenshots" : "cases",
  );
  const [selectedCases, setSelectedCases] = useState<Set<string>>(() => new Set());
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(() => new Set());
  const [downloadUrl, setDownloadUrl] = useState<string>();
  const [actorId, setActorId] = useState<string>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useState<readonly BatchReviewNote[]>([]);
  const batch = useQuery({
    queryKey: ["run-across", "batch", batchId],
    queryFn: () => runAcrossService.getReport(batchId),
    refetchInterval: (query) =>
      query.state.data && ["pilot-running", "running"].includes(query.state.data.status)
        ? 3_000
        : false,
  });
  const report = batch.data;
  const hasProblems = Boolean(
    report?.cases.some(
      (item) =>
        item.status === "failed" || item.status === "blocked" || item.status === "cancelled",
    ),
  );
  const hasFailedCases = Boolean(report?.cases.some((item) => item.status === "failed"));
  const clusters = useQuery({
    queryKey: ["run-across", "batch", batchId, "failure-clusters"],
    queryFn: () => runAcrossService.getFailureClusters(batchId),
    enabled: hasProblems,
    staleTime: 5_000,
  });
  const continueRun = useMutation({
    mutationFn: () => runAcrossService.continue(batchId),
    onSuccess: () => refreshBatch(),
  });
  const cancel = useMutation({
    mutationFn: () => runAcrossService.cancel(batchId),
    onSuccess: () => refreshBatch(),
  });
  const exportReport = useMutation({
    mutationFn: () => runAcrossService.exportReport(batchId),
    onSuccess: (value) => queryClient.setQueryData(["run-across", "batch", batchId], value),
  });
  const downloadExport = useMutation({
    mutationFn: async () => {
      if (!runAcrossService.downloadExport)
        throw new Error("Evidence pack download is unavailable in this Relay host.");
      return runAcrossService.downloadExport(batchId);
    },
    onSuccess: (blob) => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(URL.createObjectURL(blob));
    },
  });
  const rerun = useMutation({
    mutationFn: (caseIds?: readonly string[]) =>
      runAcrossService.rerun(
        batchId,
        batchRerunRequest({
          explicitCaseIds: caseIds,
          selectedCaseIds: [...selectedCases],
          selectedClusterIds: [...selectedClusters],
        }),
      ),
    onSuccess: async () => {
      setSelectedCases(new Set());
      setSelectedClusters(new Set());
      await refreshBatch();
    },
  });
  const triage = useMutation({
    mutationFn: (input: Parameters<typeof runAcrossService.triage>[1]) =>
      runAcrossService.triage(batchId, input),
    onSuccess: () => refreshBatch(),
  });
  const active = report?.status === "pilot-running" || report?.status === "running";
  const findings = useQuery({
    queryKey: ["run-across", "batch", batchId, "findings"],
    queryFn: () => runAcrossService.getFindings(batchId),
    enabled: Boolean(report) && !active,
    staleTime: 10_000,
  });
  const tests = useQuery({
    queryKey: ["tests", report?.appMapId],
    queryFn: () => catalogService.listTests({ appMapId: report?.appMapId }),
    enabled: Boolean(report?.appMapId),
    staleTime: 60_000,
  });
  const completeRuns = useQuery({
    queryKey: ["runs-complete", report?.appMapId],
    queryFn: () => catalogService.listRunsComplete!({ appMapId: report!.appMapId }),
    enabled: Boolean(report?.appMapId && typeof catalogService.listRunsComplete === "function"),
    staleTime: 15_000,
  });
  const testNames = useMemo(
    () => Object.fromEntries((tests.data ?? []).map((item) => [item.id, item.name])),
    [tests.data],
  );
  const findingsReport =
    report && !active ? resolvePlanFindings(report, findings.data, testNames) : undefined;
  const stability =
    report && completeRuns.data
      ? summarizeProductStability({
          samples: stabilitySamplesFromRuns(completeRuns.data),
          historyComplete: true,
          scope: { appMapId: report.appMapId },
        })
      : report
        ? summarizeProductStability({
            samples: stabilitySamplesFromBatch(report),
            historyComplete: false,
          })
        : undefined;
  const flakyTestIds = stability ? flakyTestIdsFromStability(stability) : new Set<string>();
  const canContinue = report?.status === "ready-to-continue" || report?.status === "needs-review";
  const clusterValues = clusters.data?.clusters ?? [];
  const selectedClusterCases = selectedClusterCaseIds(clusterValues, selectedClusters);
  const totalSelected = useMemo(
    () => new Set([...selectedCases, ...selectedClusterCases]).size,
    [selectedCases, selectedClusterCases],
  );
  useEffect(() => {
    setDownloadUrl(undefined);
    if (!report) return;
    const eligible = new Set(report.cases.filter(isBatchCaseRerunnable).map((item) => item.id));
    setSelectedCases((current) => new Set([...current].filter((id) => eligible.has(id))));
  }, [batchId, report]);

  useEffect(() => {
    void Promise.resolve(platform.getServerConnection?.()).then((connection) => {
      if (connection?.actorId) setActorId(connection.actorId);
    });
  }, [platform]);
  useEffect(() => {
    void Promise.resolve(platform.storage.get(batchReviewNotesKey(batchId)))
      .then((raw) => setNotes(parseBatchReviewNotes(raw)))
      .catch(() => setNotes([]));
  }, [batchId, platform]);

  const selectedCaseIds = useMemo(
    () => [...selectedCases, ...selectedClusterCases],
    [selectedCases, selectedClusterCases],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = batchTriageKeyboardCommand({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        repeat: event.repeat,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        overlayOpen: noteOpen,
        pending: triage.isPending,
        target: event.target,
        selectedCaseIds,
        actorId,
      });
      if (!command) return;
      event.preventDefault();
      if (command.kind === "note") {
        setNoteOpen(true);
        return;
      }
      const mutation = batchTriageMutation(command);
      if (mutation) triage.mutate(mutation);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actorId, noteOpen, selectedCaseIds, triage]);

  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );

  async function refreshBatch() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["run-across", "batch", batchId] }),
      queryClient.invalidateQueries({
        queryKey: ["run-across", "batch", batchId, "failure-clusters"],
      }),
    ]);
  }

  function toggleCase(caseId: string, checked: boolean) {
    setSelectedCases((current) => {
      const next = new Set(current);
      if (checked) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
  }

  function toggleCluster(clusterId: string, checked: boolean) {
    setSelectedClusters((current) => {
      const next = new Set(current);
      if (checked) next.add(clusterId);
      else next.delete(clusterId);
      return next;
    });
  }

  return (
    <LibraryPage className="relay-batch-page">
      <PageHeader
        crumbs={[{ label: "Results", to: "/runs" }, { label: report?.title ?? "Plan run" }]}
        title={report?.title ?? "Plan run"}
        actions={
          report ? (
            <>
              {hasFailedCases ? <IssueDraftButton source={{ kind: "batch", report }} /> : null}
              {!active && report.status !== "cancelled" && !report.export ? (
                <Button
                  variant="ghost"
                  onClick={() => exportReport.mutate()}
                  disabled={exportReport.isPending}
                >
                  {exportReport.isPending ? "Preparing…" : "Export"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {batch.isPending ? <PageLoading label="Loading results…" /> : null}
      <RecordingProblem
        error={
          batch.error ??
          continueRun.error ??
          cancel.error ??
          exportReport.error ??
          downloadExport.error ??
          rerun.error ??
          triage.error
        }
        onRetry={() => void batch.refetch()}
        retrying={batch.isFetching}
      />

      {report ? (
        <>
          <BatchResultSummary report={report} />
          {active ? (
            <div
              className="relay-batch-active mt-5 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground"
              role="status"
            >
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <p>Relay is running this Plan. Results update automatically.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? "Stopping…" : "Stop"}
              </Button>
            </div>
          ) : null}

          {canContinue ? (
            <section className="relay-batch-next-step mt-5 rounded-xl border border-border border-l-[3px] border-l-border-interactive-base bg-card p-5">
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                Review before continuing
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Check the representative Run before Relay starts the remaining cases.
              </p>
              <div className="relay-form-actions mt-3 flex flex-wrap items-center gap-2.5">
                <Button
                  variant="default"
                  onClick={() => continueRun.mutate()}
                  disabled={continueRun.isPending}
                >
                  {continueRun.isPending ? "Continuing…" : "Continue remaining cases"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Stopping…" : "Stop"}
                </Button>
              </div>
            </section>
          ) : null}

          <Tabs value={resultView} onValueChange={setResultView} className="mt-6">
            <TabsList variant="line" aria-label="Plan result view">
              {runAcrossService.getCaptureReview ? (
                <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
              ) : null}
              <TabsTrigger value="cases">Runs and problems</TabsTrigger>
            </TabsList>
            <TabsContent value="screenshots" keepMounted>
              <PlanCaptureReviewSection
                key={batchId}
                batchId={batchId}
                runAcrossService={runAcrossService}
                platform={platform}
                streaming={active}
              />
            </TabsContent>
            <TabsContent value="cases">
              {findingsReport ? (
                <BatchFindingsLead report={findingsReport} gridHasProblems={hasProblems} />
              ) : null}
              <BatchReviewWorkspace
                key={batchId}
                report={report}
                selected={selectedCases}
                onToggle={(id, checked) => toggleCase(id, checked)}
                onResolve={(id) => triage.mutateAsync({ caseIds: [id], triageStatus: "resolved" })}
                pending={triage.isPending}
                groups={(inspect) => (
                  <>
                    {hasProblems && clusters.isPending && !clusterValues.length ? (
                      <p
                        className="relay-batch-clusters-pending mt-8 text-sm text-muted-foreground"
                        role="status"
                      >
                        Grouping…
                      </p>
                    ) : null}

                    {hasProblems ? (
                      <BatchFailureClusters
                        clusters={clusterValues}
                        cases={report.cases}
                        selected={selectedClusters}
                        onToggle={(cluster, checked) => toggleCluster(cluster.id, checked)}
                        onInspect={(runId) => {
                          const item = report.cases.find((item) => item.runId === runId);
                          if (item) inspect(item.id);
                        }}
                      />
                    ) : null}

                    {clusters.isError ? (
                      <p
                        className="relay-batch-cluster-notice my-4 text-sm text-muted-foreground"
                        role="status"
                      >
                        Failure grouping is unavailable. Cases are still listed below.
                      </p>
                    ) : null}
                  </>
                )}
                matrix={(inspect) => (
                  <>
                    {report.cases.length ? (
                      <BatchResultMatrix
                        report={report}
                        selected={selectedCases}
                        testNames={testNames}
                        onToggleCase={(item, checked) => toggleCase(item.id, checked)}
                        onRerun={(item) => rerun.mutate([item.id])}
                        rerunning={rerun.isPending}
                        onInspect={(item) => inspect(item.id)}
                      />
                    ) : null}
                  </>
                )}
              />

              <div
                className={`relay-batch-selection mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 ${totalSelected ? "sticky bottom-0 z-10 shadow-md" : ""}`}
                role="region"
                aria-label="Selected cases"
              >
                <BatchTriageControls
                  selectedCount={totalSelected}
                  actorId={actorId}
                  pending={triage.isPending}
                  noteOpen={noteOpen}
                  onNoteOpenChange={setNoteOpen}
                  onStatus={(triageStatus) =>
                    triage.mutate({ caseIds: selectedCaseIds, triageStatus })
                  }
                  onAssignToMe={() => {
                    const assignee = resolveTriageActor(actorId);
                    if (assignee) triage.mutate({ caseIds: selectedCaseIds, assignee });
                  }}
                  onAddNote={(text) => {
                    const actor = resolveTriageActor(actorId);
                    if (!actor || !selectedCaseIds[0]) return;
                    const next = selectedCaseIds.reduce(
                      (notes, caseId) =>
                        appendBatchReviewNote(notes, {
                          caseId,
                          text,
                          at: Date.now(),
                          actorId: actor,
                        }),
                      notes,
                    );
                    setNotes(next);
                    void platform.storage.set(batchReviewNotesKey(batchId), JSON.stringify(next));
                  }}
                />
                {totalSelected ? (
                  <Button
                    variant="default"
                    onClick={() => rerun.mutate()}
                    disabled={rerun.isPending}
                  >
                    <RotateCcw aria-hidden="true" />
                    {rerun.isPending ? "Starting rerun…" : `Rerun ${totalSelected}`}
                  </Button>
                ) : null}
              </div>

              <details className="mt-6 rounded-xl border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Findings and review notes
                </summary>
                {findingsReport ? (
                  <BatchFindingsPanel
                    report={findingsReport}
                    actorId={actorId}
                    notes={notes}
                    flakyTestIds={flakyTestIds}
                    onNotes={(next) => {
                      setNotes(next);
                      void platform.storage.set(batchReviewNotesKey(batchId), JSON.stringify(next));
                    }}
                  />
                ) : null}
              </details>

              <BatchStabilityPanel report={report} stability={stability} />
            </TabsContent>
          </Tabs>

          {report.export ? (
            <div
              className="relay-batch-export-ready mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-[var(--text-success-base)]"
              role="status"
            >
              <p>Export ready: {report.export.jobIds.length} run artifacts prepared.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadExport.mutate()}
                disabled={downloadExport.isPending}
              >
                {downloadExport.isPending ? "Preparing download…" : "Download evidence pack"}
              </Button>
              {downloadUrl ? (
                <a
                  className={productLinkClassName}
                  href={downloadUrl}
                  download={`relay-${batchId}.tar.gz`}
                >
                  Save downloaded pack
                </a>
              ) : null}
            </div>
          ) : null}
          {report.status === "cancelled" && !report.runIds.length ? (
            <EmptyState
              title="Stopped"
              detail="No cases were started. Any representative-run evidence remains durable."
            />
          ) : null}
        </>
      ) : null}
    </LibraryPage>
  );
}
