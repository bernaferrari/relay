/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Breadcrumbs, EmptyState, OutcomeMark } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/batches/$batchId");

export function BatchPage() {
  const { runAcrossService, queryClient } = useRouteContext({ from: "__root__" });
  const { batchId } = routeApi.useParams();
  const batch = useQuery({
    queryKey: ["run-across", "batch", batchId],
    queryFn: () => runAcrossService.getReport(batchId),
    refetchInterval: (query) =>
      query.state.data && ["pilot-running", "running"].includes(query.state.data.status)
        ? 3_000
        : false,
  });
  const continueRun = useMutation({
    mutationFn: () => runAcrossService.continue(batchId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["run-across", "batch", batchId] }),
  });
  const cancel = useMutation({
    mutationFn: () => runAcrossService.cancel(batchId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["run-across", "batch", batchId] }),
  });
  const exportReport = useMutation({
    mutationFn: () => runAcrossService.exportReport(batchId),
    onSuccess: (report) => queryClient.setQueryData(["run-across", "batch", batchId], report),
  });
  const report = batch.data;
  const active = report?.status === "pilot-running" || report?.status === "running";
  const canContinue = report?.status === "ready-to-continue" || report?.status === "needs-review";
  return (
    <section className="relay-page relay-batch-page">
      <Breadcrumbs
        items={[{ label: "Runs", to: "/runs" }, { label: report?.title ?? "Batch Report" }]}
      />
      <header className="relay-page-header">
        <p className="relay-eyebrow">Batch Report</p>
        <h1>{report?.title ?? "Batch Report"}</h1>
        <p className="relay-page-description">
          The cases Relay ran, their results, and the evidence saved with each report.
        </p>
      </header>
      {batch.isPending ? <PageLoading label="Loading Batch Report…" /> : null}
      <RecordingProblem
        error={batch.error ?? continueRun.error ?? cancel.error ?? exportReport.error}
        onRetry={() => void batch.refetch()}
        retrying={batch.isFetching}
      />
      {report ? (
        <>
          <section className="relay-batch-summary" aria-labelledby="batch-summary-title">
            <OutcomeMark
              outcome={
                report.failedCases
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
                <dt>Cases</dt>
                <dd>
                  {report.completedCases} / {report.totalCases}
                </dd>
              </div>
              <div>
                <dt>Device or browser</dt>
                <dd>{report.targetNames.join(", ") || "Recorded in the Report"}</dd>
              </div>
            </dl>
          </section>
          {active ? (
            <div className="relay-batch-active" role="status">
              <span aria-hidden="true" />
              <p>Relay is running the selected cases. This page updates automatically.</p>
            </div>
          ) : null}
          {canContinue ? (
            <section className="relay-batch-next-step">
              <h2>Review the pilot before continuing</h2>
              <p>
                Relay has paused before the remaining cases. Continue deliberately after checking
                the representative Run.
              </p>
              <div className="relay-form-actions">
                <Button
                  variant="primary"
                  onClick={() => continueRun.mutate()}
                  disabled={continueRun.isPending}
                >
                  {continueRun.isPending ? "Continuing…" : "Continue remaining cases"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Stopping…" : "Stop batch"}
                </Button>
              </div>
            </section>
          ) : null}
          {report.runIds.length ? (
            <section className="relay-batch-runs">
              <h2>Reports in this batch</h2>
              <ul>
                {report.runIds.map((runId, index) => (
                  <li key={runId}>
                    <span>Report {index + 1}</span>
                    <Link to="/runs/$runId" params={{ runId }}>
                      Open report <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!active && report.status !== "cancelled" && !report.export ? (
            <Button
              className="relay-batch-export"
              variant="secondary"
              onClick={() => exportReport.mutate()}
              disabled={exportReport.isPending}
            >
              {exportReport.isPending ? "Preparing export…" : "Prepare Batch export"}
            </Button>
          ) : null}
          {report.export ? (
            <p className="relay-batch-export-ready" role="status">
              Export prepared in the Relay workspace.
            </p>
          ) : null}
          {report.status === "cancelled" && !report.runIds.length ? (
            <EmptyState
              title="Batch stopped"
              detail="No remaining cases were started. The pilot evidence remains durable."
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
