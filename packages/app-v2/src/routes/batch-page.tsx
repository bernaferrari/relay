/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumbs, EmptyState, OutcomeMark } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import { isBatchCaseRerunnable, selectedClusterCaseIds } from "./batch-triage";
import { BatchFailureClusters, BatchResultMatrix } from "./batch-triage-panels";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/batches/$batchId");
type MatrixView = "problems" | "all";

export function BatchPage() {
  const { runAcrossService, queryClient } = useRouteContext({ from: "__root__" });
  const { batchId } = routeApi.useParams();
  const search = routeApi.useSearch() as { view?: unknown };
  const navigate = useNavigate({ from: "/batches/$batchId" });
  const view: MatrixView = search.view === "all" ? "all" : "problems";
  const [selectedCases, setSelectedCases] = useState<Set<string>>(() => new Set());
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(() => new Set());
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
  const rerun = useMutation({
    mutationFn: () =>
      runAcrossService.rerun(batchId, {
        ...(selectedCases.size ? { caseIds: [...selectedCases] } : {}),
        ...(selectedClusters.size ? { clusterIds: [...selectedClusters] } : {}),
      }),
    onSuccess: async () => {
      setSelectedCases(new Set());
      setSelectedClusters(new Set());
      await refreshBatch();
    },
  });
  const active = report?.status === "pilot-running" || report?.status === "running";
  const canContinue = report?.status === "ready-to-continue" || report?.status === "needs-review";
  const clusterValues = clusters.data?.clusters ?? [];
  const selectedClusterCases = selectedClusterCaseIds(clusterValues, selectedClusters);
  const totalSelected = useMemo(
    () => new Set([...selectedCases, ...selectedClusterCases]).size,
    [selectedCases, selectedClusterCases],
  );
  const rerunnableCases = report?.cases.filter(isBatchCaseRerunnable) ?? [];

  useEffect(() => {
    if (!report) return;
    const eligible = new Set(report.cases.filter(isBatchCaseRerunnable).map((item) => item.id));
    setSelectedCases((current) => new Set([...current].filter((id) => eligible.has(id))));
  }, [report]);

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
    <section className="relay-page relay-batch-page">
      <Breadcrumbs items={[{ label: "Runs", to: "/runs" }, { label: report?.title ?? "Batch" }]} />
      <header className="relay-page-header relay-batch-header">
        <div>
          <p className="relay-eyebrow">Run Across</p>
          <h1>{report?.title ?? "Batch"}</h1>
          <p className="relay-page-description">
            Triage failures across Tests and Environments, then rerun only the evidence-backed cases
            you select.
          </p>
        </div>
        {report ? (
          <div className="relay-batch-header-actions">
            <IssueDraftButton source={{ kind: "batch", report }} />
            {!active && report.status !== "cancelled" && !report.export ? (
              <Button
                variant="outline"
                onClick={() => exportReport.mutate()}
                disabled={exportReport.isPending}
              >
                {exportReport.isPending ? "Preparing…" : "Prepare export"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {batch.isPending ? <PageLoading label="Loading Batch…" /> : null}
      <RecordingProblem
        error={
          batch.error ?? continueRun.error ?? cancel.error ?? exportReport.error ?? rerun.error
        }
        onRetry={() => void batch.refetch()}
        retrying={batch.isFetching}
      />

      {report ? (
        <>
          <section className="relay-batch-summary" aria-labelledby="batch-summary-title">
            <OutcomeMark
              outcome={
                hasProblems
                  ? "product-failure"
                  : report.status === "completed"
                    ? "passed"
                    : undefined
              }
            />
            <div>
              <h2 id="batch-summary-title">{report.report.headline}</h2>
              <p>{report.report.detail}</p>
            </div>
            <dl>
              <div>
                <dt>Passed</dt>
                <dd>{report.passedCases}</dd>
              </div>
              <div>
                <dt>Problems</dt>
                <dd>
                  {
                    report.cases.filter((item) =>
                      ["failed", "blocked", "cancelled"].includes(item.status),
                    ).length
                  }
                </dd>
              </div>
              <div>
                <dt>Complete</dt>
                <dd>
                  {report.completedCases} / {report.totalCases}
                </dd>
              </div>
            </dl>
          </section>

          {active ? (
            <div className="relay-batch-active" role="status">
              <span aria-hidden="true" />
              <p>Relay is running this Batch. Results update automatically.</p>
            </div>
          ) : null}

          {canContinue ? (
            <section className="relay-batch-next-step">
              <h2>Review the pilot before continuing</h2>
              <p>Check the representative Run before Relay starts the remaining cases.</p>
              <div className="relay-form-actions">
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
                  {cancel.isPending ? "Stopping…" : "Stop Batch"}
                </Button>
              </div>
            </section>
          ) : null}

          {hasProblems ? (
            <BatchFailureClusters
              clusters={clusterValues}
              selected={selectedClusters}
              onToggle={(cluster, checked) => toggleCluster(cluster.id, checked)}
            />
          ) : null}

          {clusters.isError ? (
            <p className="relay-batch-cluster-notice" role="status">
              Failure grouping is unavailable, but every case and Report remains available below.
            </p>
          ) : null}

          {report.cases.length ? (
            <>
              <div className="relay-batch-matrix-toolbar">
                <Tabs
                  value={view}
                  onValueChange={(next) =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        view: next === "problems" ? undefined : next,
                      }),
                    })
                  }
                >
                  <TabsList variant="line" aria-label="Matrix results">
                    <TabsTrigger value="problems">Problems first</TabsTrigger>
                    <TabsTrigger value="all">All results</TabsTrigger>
                  </TabsList>
                </Tabs>
                {rerunnableCases.length ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelectedCases(
                        selectedCases.size === rerunnableCases.length
                          ? new Set()
                          : new Set(rerunnableCases.map((item) => item.id)),
                      )
                    }
                  >
                    {selectedCases.size === rerunnableCases.length
                      ? "Clear selection"
                      : "Select all problems"}
                  </Button>
                ) : null}
              </div>
              <BatchResultMatrix
                report={report}
                failuresOnly={view === "problems" && hasProblems}
                selected={selectedCases}
                onToggleCase={(item, checked) => toggleCase(item.id, checked)}
              />
            </>
          ) : null}

          {totalSelected ? (
            <div className="relay-batch-selection" role="region" aria-label="Selected Batch cases">
              <div>
                <strong>{totalSelected} selected</strong>
                <span>
                  Only failed, blocked, or cancelled cases with durable Run evidence can be rerun.
                </span>
              </div>
              <Button variant="default" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
                <RotateCcw aria-hidden="true" />
                {rerun.isPending ? "Starting rerun…" : `Rerun ${totalSelected}`}
              </Button>
            </div>
          ) : null}

          {report.export ? (
            <p className="relay-batch-export-ready" role="status">
              Export prepared in the Relay workspace.
            </p>
          ) : null}
          {report.status === "cancelled" && !report.runIds.length ? (
            <EmptyState
              title="Batch stopped"
              detail="No cases were started. Any pilot evidence remains durable."
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
