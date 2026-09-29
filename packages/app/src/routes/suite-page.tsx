import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
/** @jsxImportSource react */
import { catalogQueryKeys } from "../data/catalog-queries";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel as ChoiceLabel } from "@relay/ui-react/components/field";
import { productTestStatusLabel } from "@relay/product/catalog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, ReadinessMark, RecoveryState } from "../components/product-patterns";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { useRunConfigurationKey } from "../data/use-persisted-run-configuration";
import { usePersistedRunConfiguration } from "../data/use-persisted-run-configuration";
import {
  compilePlanAccountColumns,
  compileSuiteTargets,
  missingPlanAccountMessage,
} from "../data/paired-configuration";
import { usePairedConfigurationWorkspace } from "../data/use-paired-configuration-workspace";
import { PlanDailySchedule } from "./plan-daily-schedule";
import { PlanChecklist } from "./plan-checklist";
import { PlanEditDialog, PlanRemoveSection } from "./plan-edit-dialog";
import { PageLoading } from "./recording-shared";
import { friendlySuiteIssue, summarizeSuiteSetup } from "../data/suite-preflight-copy";
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/apps/$appId/suites/$suiteId");
/** After this long without a setup answer, say so next to the Run button. */
const PREVIEW_SLOW_MS = 5_000;

// Start with one setup so a saved Plan cannot unexpectedly launch every
// device, account, and data combination at once.
export const defaultPlanExecutionMode = "pilot" as const;

export function planRunCountLabel(input: {
  blockers: number;
  plannedCases: number;
  executionMode: "pilot" | "all";
}): string {
  if (input.blockers > 0) return "Setup needed before running";
  if (input.plannedCases <= 1) return "Every test runs once";
  if (input.executionMode === "all") return `Every test runs on ${input.plannedCases} setups`;
  return `One setup first, then ${input.plannedCases - 1} more when you continue`;
}

export function SuitePage() {
  const { suiteProfileService, catalogService, queryClient, platform, runAcrossService } =
    useRouteContext({
      from: "__root__",
    });
  const { appId, suiteId } = routeApi.useParams();
  const navigate = useNavigate();
  const scope = useRunConfigurationKey(platform, `suite:${suiteId}`, appId);
  const [editOpen, setEditOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<"pilot" | "all">(defaultPlanExecutionMode);
  const suite = useQuery({
    queryKey: ["suites", appId, suiteId],
    queryFn: () => suiteProfileService.getSuite(appId, suiteId),
    staleTime: 10_000,
  });
  const environments = useQuery({
    queryKey: ["environments"],
    queryFn: () => suiteProfileService.listEnvironmentProfiles(),
    staleTime: 10_000,
  });
  const configuration = usePersistedRunConfiguration({
    storage: platform.storage,
    key: scope.key,
    targetOptions: environments.data?.map((item) => ({ id: item.id, label: item.name })),
  });
  // Start from where this App's checks ran last time, or the only setup there is.
  const appRuns = useQuery({
    queryKey: [...catalogQueryKeys.runs, "app", appId],
    queryFn: () => catalogService.listRuns({ appMapId: appId }),
    staleTime: 5_000,
  });
  const lastProfileId = [...(appRuns.data ?? [])]
    .sort((left, right) => right.queuedAt - left.queuedAt)
    .map(
      (run) =>
        run.executionIdentity?.targetProfileId ??
        // Older runs only name the target they ran on.
        environments.data?.find((item) => item.targetId === run.executionIdentity?.deviceId)?.id,
    )
    .find((id) => id && environments.data?.some((item) => item.id === id));
  useEffect(() => {
    if (!configuration.pristine || !environments.data) return;
    const id =
      lastProfileId ?? (environments.data.length === 1 ? environments.data[0]!.id : undefined);
    if (id) configuration.setSelection({ targetProfileIds: [id], targetProfileId: id });
  }, [configuration.pristine, configuration.setSelection, environments.data, lastProfileId]);
  const paired = usePairedConfigurationWorkspace(platform);
  const compiledSuite = compileSuiteTargets(paired.workspace, environments.data ?? []);
  const accountColumns = compilePlanAccountColumns(paired.workspace, environments.data ?? []);
  const missingAccountMessage = configuration.selection.usePairedWorkspace
    ? missingPlanAccountMessage(accountColumns)
    : undefined;
  const missingAccountBlockers = missingAccountMessage
    ? [{ code: "missing-binding", message: missingAccountMessage }]
    : [];
  const selectedProfileIds = configuration.selection.usePairedWorkspace
    ? compiledSuite.profileIds
    : [
        ...(configuration.selection.targetProfileIds ??
          (configuration.selection.targetProfileId
            ? [configuration.selection.targetProfileId]
            : [])),
      ];
  const preview = useQuery({
    queryKey: [
      "suites",
      appId,
      suiteId,
      "preview",
      selectedProfileIds,
      configuration.selection.usePairedWorkspace ? paired.workspace.rows : [],
    ],
    queryFn: () =>
      suiteProfileService.previewSuite({
        appMapId: appId,
        suiteId,
        profileIds: selectedProfileIds,
        ...(configuration.selection.usePairedWorkspace
          ? {
              accounts: accountColumns.accounts,
            }
          : {}),
      }),
    enabled: Boolean(suite.data && selectedProfileIds.length && !configuration.targetUnavailable),
    retry: false,
  });
  const start = useMutation({
    mutationFn: () => {
      if (missingAccountMessage) throw new TypeError(missingAccountMessage);
      return suiteProfileService.startSuite({
        appMapId: appId,
        suiteId,
        profileIds: selectedProfileIds,
        executionMode,
        ...(configuration.selection.usePairedWorkspace
          ? {
              accounts: accountColumns.accounts,
            }
          : {}),
      });
    },
    onSuccess: ({ batchId }) => navigate({ to: "/batches/$batchId", params: { batchId } }),
  });
  // A plan runs once at a time. A run lost to a restart keeps the slot until
  // someone stops it, so offer that right where Run was refused.
  const restart = useMutation({
    mutationFn: async (batchId: string) => {
      await runAcrossService.cancel(batchId);
      start.reset();
      await start.mutateAsync();
    },
  });
  const schedule = useMutation({
    mutationFn: (input: { hour: number; timezone: string }) => {
      if (!suiteProfileService.schedulePlan)
        throw new TypeError("Scheduling this Plan is unavailable.");
      if (missingAccountMessage) throw new TypeError(missingAccountMessage);
      const profileId = selectedProfileIds[0];
      if (!profileId) throw new TypeError("Choose a browser or device first.");
      return suiteProfileService.schedulePlan({
        appMapId: appId,
        combineId: suiteId,
        profileId,
        profileIds: selectedProfileIds,
        ...(configuration.selection.usePairedWorkspace
          ? {
              accounts: accountColumns.accounts,
            }
          : {}),
        hour: input.hour,
        timezone: input.timezone,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites", appId, suiteId, "schedules"] });
    },
  });
  const removeSchedule = useMutation({
    mutationFn: (id: string) => {
      if (!suiteProfileService.removePlanSchedule)
        throw new TypeError("Removing schedules is unavailable.");
      return suiteProfileService.removePlanSchedule(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites", appId, suiteId, "schedules"] });
    },
  });
  const planSchedules = useQuery({
    queryKey: ["suites", appId, suiteId, "schedules"],
    queryFn: () => {
      if (!suiteProfileService.listPlanSchedules)
        throw new TypeError("Listing schedules is unavailable.");
      return suiteProfileService.listPlanSchedules({ combineId: suiteId });
    },
    enabled: Boolean(suiteProfileService.listPlanSchedules),
    staleTime: 10_000,
  });
  const value = suite.data;
  const needsReview = value?.tests.some((test) => test.status === "needs-review") ?? false;
  const previewBlockers = [...missingAccountBlockers, ...(preview.data?.blockers ?? [])];
  const plannedCases = preview.data?.caseCount ?? 0;
  const previewWaiting = Boolean(selectedProfileIds.length) && !preview.data && !preview.error;
  const previewChecking = previewWaiting && preview.isFetching;
  const [previewSlow, setPreviewSlow] = useState(false);
  useEffect(() => {
    if (!previewChecking) {
      setPreviewSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setPreviewSlow(true), PREVIEW_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [previewChecking]);
  // The Run button is disabled until the setup check answers; say why instead of going dead.
  const runHint: { tone: "muted" | "error"; message: string } | null = !selectedProfileIds.length
    ? null
    : configuration.targetUnavailable
      ? { tone: "error", message: "The saved browser is unavailable. Choose another in Run setup." }
      : preview.error
        ? {
            tone: "error",
            message: `Relay could not check this Plan: ${
              preview.error instanceof Error ? preview.error.message : "unknown error"
            }`,
          }
        : previewChecking && previewSlow
          ? { tone: "muted", message: "Still checking this Plan's setup…" }
          : null;
  const unfinishedBatchId = unfinishedRunOf(start.error);
  const runningCases = executionMode === "pilot" ? Math.min(1, plannedCases) : plannedCases;

  return (
    <LibraryPage className="max-w-5xl">
      {suite.isPending ? <PageLoading label="Loading Plan…" /> : null}
      {suite.error ? (
        <RecoveryState
          layout="centered"
          title="This Plan is unavailable"
          detail="Relay could not load this plan. Try again."
          action={
            <Button variant="outline" onClick={() => void suite.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {!suite.isPending && !suite.error && !value ? (
        <EmptyState
          title="Plan not found"
          detail="It may have been removed from this App."
          action={
            <Link className={productLinkClassName} to="/suites">
              Back to Plans
            </Link>
          }
        />
      ) : null}
      {value ? (
        <>
          <PageHeader
            crumbs={[{ label: "Tests", to: "/tests" }, { label: value.name }]}
            title={value.name}
            description={[
              `${value.tests.length} ${value.tests.length === 1 ? "test" : "tests"}`,
              value.appName,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <Button variant="ghost" onClick={() => setEditOpen(true)}>
                Edit Plan
              </Button>
            }
          />

          <div className="mt-6 grid min-w-0 items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_22rem]">
            <PlanChecklist appId={appId} suiteId={suiteId} tests={value.tests} />

            <section
              id="suite-run-setup"
              className="min-w-0 rounded-xl border border-border bg-card p-4"
              aria-labelledby="suite-environment-title"
            >
              <RunConfigurationComposer
                variant="plain"
                title={<span id="suite-environment-title">Run setup</span>}
                configuration={{
                  frozen: false,
                  values: {
                    targetProfileId: selectedProfileIds[0],
                    targetName: environments.data?.find((item) => item.id === selectedProfileIds[0])
                      ?.name,
                    dataSetName: value.variableIds.length
                      ? `${value.variableIds.length} saved data sets`
                      : undefined,
                  },
                  blockers: selectedProfileIds.length
                    ? [
                        ...(configuration.targetUnavailable
                          ? [
                              {
                                id: "target",
                                label: "Saved browser is unavailable",
                                detail: "Choose another browser to continue.",
                              },
                            ]
                          : []),
                        ...missingAccountBlockers.map((blocker) => ({
                          id: blocker.code,
                          label: "Accounts are missing",
                          detail: blocker.message,
                        })),
                      ]
                    : [],
                  validated: Boolean(
                    preview.data &&
                    !previewBlockers.length &&
                    preview.data.execution?.capacity !== "unavailable",
                  ),
                }}
                targetOptions={environments.data?.map((item) => ({
                  id: item.id,
                  label: item.name,
                  platform: item.platform,
                  detail: item.target.name === item.name ? undefined : item.target.name,
                }))}
                multipleTargets
                loading={configuration.loading}
                error={scope.error ?? configuration.error}
                onRetry={scope.error ? scope.retry : configuration.retry}
                selection={configuration.selection}
                onSelectionChange={configuration.setSelection}
                pairedWorkspaceLabel={
                  paired.workspace.rows.length
                    ? `Use saved workspace · ${paired.workspace.rows.length} paired configurations`
                    : undefined
                }
              />
              {configuration.selection.usePairedWorkspace ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  <table className="w-full table-fixed text-left text-xs [&_td]:wrap-anywhere">
                    <caption className="px-3 py-2 text-left font-medium text-foreground">
                      Selected configurations
                    </caption>
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Browser or device
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Sign-in
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paired.workspace.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">
                            {row.browserName} · {row.engine ?? "chromium"}
                          </td>
                          <td className="px-3 py-2">
                            {row.accountName ??
                              (row.signedOutAttested ? "Signed out" : "Choose a sign-in")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {plannedCases > 1 ? (
                <>
                  <p className="mt-5 border-t border-border pt-4 text-sm font-medium">
                    {plannedCases} data combinations
                  </p>
                  <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
                    Try one first, or run every combination.
                  </p>
                  <Tabs
                    value={executionMode}
                    onValueChange={(value) => setExecutionMode(value as "pilot" | "all")}
                  >
                    <TabsList
                      aria-label="Execution scope"
                      className="w-full group-data-horizontal/tabs:h-11"
                    >
                      <TabsTrigger value="pilot">One first</TabsTrigger>
                      <TabsTrigger value="all">All {plannedCases}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </>
              ) : null}
              {preview.data || missingAccountBlockers.length ? (
                <div
                  className={`mt-4 grid gap-1 rounded-lg border p-3 text-xs ${
                    previewBlockers.length
                      ? "border-border bg-muted/30"
                      : "border-border bg-muted/30"
                  }`}
                  role="status"
                >
                  <strong className="font-semibold text-foreground">
                    {planRunCountLabel({
                      blockers: previewBlockers.length,
                      plannedCases,
                      executionMode,
                    })}
                  </strong>
                  {preview.data && !previewBlockers.length ? (
                    <span className="text-muted-foreground">
                      {preview.data.checkCount} {preview.data.checkCount === 1 ? "test" : "tests"}
                      {preview.data.expectedScreenshots === undefined
                        ? ""
                        : ` · about ${preview.data.expectedScreenshots} screenshots`}
                    </span>
                  ) : null}
                  {!previewBlockers.length && preview.data?.execution?.detail ? (
                    <details className="mt-2 text-muted-foreground">
                      <summary className="cursor-pointer py-1">How Relay will run it</summary>
                      <p className="mt-1 leading-5">{preview.data.execution.detail}</p>
                    </details>
                  ) : null}
                  {previewBlockers.slice(0, 1).map((blocker) => (
                    <p
                      className="text-sm leading-6 text-foreground"
                      key={`${blocker.code}:${"suiteCellId" in blocker ? blocker.suiteCellId : "suite"}`}
                    >
                      {friendlySuiteIssue(
                        blocker.message,
                        environments.data?.map((item) => ({ id: item.targetId, name: item.name })),
                      )}
                    </p>
                  ))}
                  {previewBlockers.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedProfileIds.length === 1 ? (
                        <Button
                          nativeButton={false}
                          variant="outline"
                          size="sm"
                          render={
                            <Link
                              to="/environments/$profileId"
                              params={{ profileId: selectedProfileIds[0]! }}
                            />
                          }
                        >
                          Open selected setup
                        </Button>
                      ) : (
                        <Button
                          nativeButton={false}
                          variant="outline"
                          size="sm"
                          render={<Link to="/devices" />}
                        >
                          Open devices &amp; browsers
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={preview.isFetching}
                        onClick={() => void preview.refetch()}
                      >
                        {preview.isFetching ? "Checking…" : "Recheck setup"}
                      </Button>
                    </div>
                  ) : null}
                  {previewBlockers.length > 1 ? (
                    <details className="mt-2 text-muted-foreground">
                      <summary className="cursor-pointer py-1">Other setup issues</summary>
                      <ul className="mt-2 grid gap-2 text-sm leading-6">
                        {summarizeSuiteSetup(
                          previewBlockers.slice(1).map((blocker) => blocker.message),
                        ).map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
              {preview.error ? (
                <FieldError>
                  {preview.error instanceof Error
                    ? preview.error.message
                    : "Relay could not check this Plan."}
                </FieldError>
              ) : null}
              <div className="mt-5 grid gap-3 border-t border-border pt-4">
                {runHint ? (
                  <p
                    className={`text-sm leading-5 ${runHint.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    role={runHint.tone === "error" ? "alert" : "status"}
                  >
                    {runHint.message}
                  </p>
                ) : null}
                {unfinishedBatchId ? (
                  <Button
                    nativeButton={false}
                    className="w-full"
                    render={<Link to="/batches/$batchId" params={{ batchId: unfinishedBatchId }} />}
                  >
                    Open existing result
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => start.mutate()}
                    disabled={
                      !selectedProfileIds.length ||
                      !preview.data ||
                      Boolean(previewBlockers.length) ||
                      preview.data.execution?.capacity === "unavailable" ||
                      start.isPending
                    }
                  >
                    <Play aria-hidden="true" />
                    {!selectedProfileIds.length
                      ? "Choose where to run"
                      : previewChecking
                        ? "Checking setup…"
                        : start.isPending
                          ? "Starting…"
                          : executionMode === "all" && plannedCases > 1
                            ? `Run on all ${plannedCases} setups`
                            : `Run ${value.tests.length === 1 ? "test" : `all ${value.tests.length} tests`}`}
                  </Button>
                )}
                {preview.error ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={preview.isFetching}
                    onClick={() => void preview.refetch()}
                  >
                    {preview.isFetching ? "Checking…" : "Retry setup check"}
                  </Button>
                ) : null}
              </div>
              {unfinishedBatchId ? (
                <div
                  className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
                  role="alert"
                >
                  <p>
                    <strong className="font-semibold">
                      This plan has a run that never finished.
                    </strong>{" "}
                    Open the existing result to see where it stopped, or stop it and run the plan
                    again.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={restart.isPending}
                      onClick={() => restart.mutate(unfinishedBatchId)}
                    >
                      <Play aria-hidden="true" />
                      {restart.isPending ? "Stopping…" : "Stop it and run again"}
                    </Button>
                  </div>
                  {restart.error ? (
                    <p className="text-destructive">
                      {restart.error instanceof Error
                        ? restart.error.message
                        : "Relay could not stop that run."}
                    </p>
                  ) : null}
                </div>
              ) : start.error ? (
                <FieldError>
                  {start.error instanceof Error
                    ? start.error.message
                    : "Relay could not start this Plan."}
                </FieldError>
              ) : null}
            </section>
          </div>

          {suiteProfileService.schedulePlan ? (
            <PlanDailySchedule
              disabled={
                !selectedProfileIds.length ||
                Boolean(previewBlockers.length) ||
                planSchedules.isLoading
              }
              pending={schedule.isPending || removeSchedule.isPending}
              error={removeSchedule.error || schedule.error || planSchedules.error}
              targetName={environments.data
                ?.filter((item) => selectedProfileIds.includes(item.id))
                .map((item) => item.name)
                .join(", ")}
              onRemove={
                suiteProfileService.removePlanSchedule
                  ? (id) => removeSchedule.mutate(id)
                  : undefined
              }
              schedules={planSchedules.data ?? []}
              onSave={(input) => schedule.mutate(input)}
            />
          ) : null}

          <PlanRemoveSection appId={appId} suiteId={suiteId} value={value} />

          {editOpen ? (
            <PlanEditDialog
              appId={appId}
              suiteId={suiteId}
              value={value}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          ) : null}
        </>
      ) : null}
    </LibraryPage>
  );
}

/** The unfinished plan run that blocked a start, if that is why it failed. */
function unfinishedRunOf(error: unknown): string | undefined {
  const body = (error as { body?: { code?: unknown; repeatId?: unknown } } | null)?.body;
  return body?.code === "ACTIVE_REPEAT_EXISTS" && typeof body.repeatId === "string"
    ? body.repeatId
    : undefined;
}
