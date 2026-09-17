/** @jsxImportSource react */
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
import { PageLoading } from "./recording-shared";
import { friendlySuiteIssue } from "../data/suite-preflight-copy";

const routeApi = getRouteApi("/apps/$appId/suites/$suiteId");

export function SuitePage() {
  const { suiteProfileService, queryClient, platform } = useRouteContext({ from: "__root__" });
  const { appId, suiteId } = routeApi.useParams();
  const navigate = useNavigate();
  const scope = useRunConfigurationKey(platform, `suite:${suiteId}`, appId);
  const [editOpen, setEditOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<"pilot" | "all">("all");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [name, setName] = useState("");
  const [testIds, setTestIds] = useState<Set<string>>(() => new Set());
  const [variableIds, setVariableIds] = useState<Set<string>>(() => new Set());
  const suite = useQuery({
    queryKey: ["suites", appId, suiteId],
    queryFn: () => suiteProfileService.getSuite(appId, suiteId),
    staleTime: 10_000,
  });
  const editor = useQuery({
    queryKey: ["suites", "editor", appId],
    queryFn: () => suiteProfileService.getSuiteEditor(appId),
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
  useEffect(() => {
    if (configuration.pristine && environments.data?.length === 1)
      configuration.setSelection({
        targetProfileIds: [environments.data[0]!.id],
        targetProfileId: environments.data[0]!.id,
      });
  }, [configuration.pristine, configuration.setSelection, environments.data]);
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
  const save = useMutation({
    mutationFn: () => {
      if (!suite.data) throw new TypeError("This Plan is unavailable.");
      return suiteProfileService.saveSuite({
        appMapId: appId,
        suiteId,
        expectedRevision: suite.data.appMapRevision,
        name,
        testIds: [...testIds],
        variableIds: [...variableIds],
        strategy: suite.data.strategy ?? "cartesian",
        selected: suite.data.selected,
      });
    },
    onSuccess: async (value) => {
      queryClient.setQueryData(["suites", appId, suiteId], value);
      await queryClient.invalidateQueries({ queryKey: ["suites"] });
      setEditOpen(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!suite.data) throw new TypeError("This Plan is unavailable.");
      return suiteProfileService.removeSuite({
        appMapId: appId,
        suiteId,
        expectedRevision: suite.data.appMapRevision,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites"] });
      await navigate({ to: "/suites" });
    },
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
  });
  const value = suite.data;
  const needsReview = value?.tests.some((test) => test.status === "needs-review") ?? false;
  const previewBlockers = [...missingAccountBlockers, ...(preview.data?.blockers ?? [])];

  function beginEdit() {
    if (!value) return;
    setName(value.name);
    setTestIds(new Set(value.testIds));
    setVariableIds(new Set(value.variableIds));
    save.reset();
    setEditOpen(true);
  }

  function toggle(setter: typeof setTestIds, id: string, checked: boolean) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <LibraryPage className="max-w-5xl">
      {suite.isPending || editor.isPending ? <PageLoading label="Loading Plan…" /> : null}
      {suite.error || editor.error ? (
        <RecoveryState
          layout="centered"
          title="This Plan is unavailable"
          detail="Reload the saved coverage plan before making changes or starting work."
          action={
            <Button
              variant="outline"
              onClick={() => {
                void suite.refetch();
                void editor.refetch();
              }}
            >
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
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/suites"
            >
              Back to Plans
            </Link>
          }
        />
      ) : null}
      {value ? (
        <>
          <PageHeader
            crumbs={[{ label: "Plans", to: "/suites" }, { label: value.name }]}
            title={value.name}
            description={
              value.appName
                ? `${value.appName}. Choose where to run, then run every case.`
                : "Choose where to run, then run every case."
            }
            actions={
              <>
                <Button variant="ghost" onClick={beginEdit}>
                  Edit
                </Button>
                <Button
                  variant="default"
                  onClick={() => start.mutate()}
                  disabled={
                    !selectedProfileIds.length ||
                    !preview.data ||
                    Boolean(previewBlockers.length) ||
                    preview.data?.execution?.capacity === "unavailable" ||
                    start.isPending
                  }
                >
                  <Play aria-hidden="true" />
                  {start.isPending
                    ? "Starting…"
                    : executionMode === "all"
                      ? "Run all cases"
                      : "Run"}
                </Button>
              </>
            }
          />

          <dl
            className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border-weak-base py-3"
            aria-label={`${value.name} scope`}
          >
            <div className="flex items-center gap-2">
              <dt className="text-xs text-text-weaker">Tests</dt>
              <dd className="text-sm font-semibold text-text-strong">{value.tests.length}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-xs text-text-weaker">Data sets</dt>
              <dd className="text-sm font-semibold text-text-strong">{value.variableIds.length}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-xs text-text-weaker">Status</dt>
              <dd>
                <ReadinessMark status={needsReview ? "needs-review" : "ready"} />
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
            <section
              className="min-w-0 rounded-xl border border-border-weak-base bg-surface-raised-strong p-4"
              aria-labelledby="suite-tests-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Coverage
              </p>
              <h2 id="suite-tests-title" className="mt-1 text-base font-semibold text-text-strong">
                Saved Tests
              </h2>
              <ul className="mt-4 grid list-none gap-2 p-0">
                {value.tests.map((test) => (
                  <li key={test.id}>
                    <Link
                      className="flex min-h-9 items-center justify-between gap-3 rounded-md bg-background-weak px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                      to="/tests/$testId"
                      params={{ testId: test.id }}
                    >
                      <span className="truncate text-sm font-medium text-text-strong">
                        {test.name}
                      </span>
                      <ReadinessMark
                        status={test.status === "ready" ? "ready" : "needs-review"}
                        name={test.name}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-border-weak-base pt-3 text-xs leading-5 text-text-weak">
                {value.variableIds.length
                  ? `${value.variableIds.length} saved Data ${
                      value.variableIds.length === 1 ? "set" : "sets"
                    } will be applied.`
                  : "Each Test runs once with its saved defaults."}
              </p>
            </section>

            <section
              className="min-w-0 rounded-xl border border-border-weak-base bg-surface-raised-strong p-4"
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
                    : [{ id: "target", label: "Choose where to run before starting" }],
                  validated: Boolean(
                    preview.data &&
                    !previewBlockers.length &&
                    preview.data.execution?.capacity !== "unavailable",
                  ),
                }}
                targetOptions={environments.data?.map((item) => ({
                  id: item.id,
                  label: item.name,
                  detail: `${item.platform} · ${item.target.name}`,
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
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-xs">
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
                    {configuration.selection.usePairedWorkspace
                      ? paired.workspace.rows.map((row) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              {row.browserName} · {row.engine ?? "chromium"}
                            </td>
                            <td className="px-3 py-2">
                              {row.accountName ??
                                (row.signedOutAttested ? "Signed out" : "Choose a sign-in")}
                            </td>
                          </tr>
                        ))
                      : (
                          preview.data?.environments ??
                          (preview.data?.environment ? [preview.data.environment] : [])
                        ).map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2">{item.name}</td>
                            <td className="px-3 py-2">Current session</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-5 border-t border-border pt-4 text-sm font-medium">
                How much should run?
              </p>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">
                Run every selected case, or one representative case.
              </p>
              <div className="flex items-center gap-2" role="group" aria-label="Execution scope">
                <Button
                  aria-pressed={executionMode === "pilot"}
                  variant={executionMode === "pilot" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setExecutionMode("pilot")}
                >
                  One case
                </Button>
                <Button
                  aria-pressed={executionMode === "all"}
                  variant={executionMode === "all" ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setExecutionMode("all")}
                >
                  All cases
                </Button>
              </div>
              {preview.data || missingAccountBlockers.length ? (
                <div
                  className={`mt-4 grid gap-1 rounded-lg border p-3 text-xs ${
                    previewBlockers.length
                      ? "border-border-critical-base bg-surface-critical-weak"
                      : "border-border bg-muted/30"
                  }`}
                  role="status"
                >
                  <strong className="font-semibold text-text-strong">
                    {previewBlockers.length
                      ? "Needs attention"
                      : `Full Plan: ${preview.data?.caseCount} ${
                          preview.data?.caseCount === 1 ? "case" : "cases"
                        } ${
                          preview.data?.execution?.capacity === "unavailable"
                            ? "previewed"
                            : "ready"
                        }`}
                  </strong>
                  {preview.data ? (
                    <span className="text-text-weak">
                      {preview.data.checkCount} {preview.data.checkCount === 1 ? "check" : "checks"}
                      {preview.data.expectedScreenshots === undefined
                        ? ""
                        : ` · about ${preview.data.expectedScreenshots} screenshots`}
                    </span>
                  ) : null}
                  {!previewBlockers.length && executionMode === "pilot" ? (
                    <span className="mt-1 font-medium text-foreground">
                      This run uses one representative case.
                    </span>
                  ) : null}
                  {preview.data?.execution?.detail ? (
                    <details className="mt-2 text-text-weak">
                      <summary className="cursor-pointer py-1">Execution details</summary>
                      <p className="mt-1 leading-5">{preview.data.execution.detail}</p>
                    </details>
                  ) : null}
                  {previewBlockers.slice(0, 1).map((blocker) => (
                    <small
                      className="leading-5 text-text-weak"
                      key={`${blocker.code}:${"suiteCellId" in blocker ? blocker.suiteCellId : "suite"}`}
                    >
                      {friendlySuiteIssue(blocker.message)}
                    </small>
                  ))}
                </div>
              ) : null}
              {preview.error ? (
                <FieldError>
                  {preview.error instanceof Error
                    ? preview.error.message
                    : "Relay could not check this Plan."}
                </FieldError>
              ) : null}
              {start.error ? (
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
              disabled={!selectedProfileIds.length || Boolean(missingAccountBlockers.length)}
              pending={schedule.isPending}
              error={schedule.error}
              onSave={(input) => schedule.mutate(input)}
            />
          ) : null}

          <section
            className="mt-8 flex items-center justify-between gap-5 border-t border-border-weak-base pt-5 max-sm:items-start"
            aria-labelledby="remove-suite-title"
          >
            <div>
              <h2 id="remove-suite-title" className="text-sm font-semibold text-text-strong">
                Remove Plan
              </h2>
              <p className="mt-1 text-xs leading-5 text-text-weak">
                Tests and Reports stay in the App.
              </p>
            </div>
            <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
              <DialogTrigger render={<Button variant="outline" />}>
                <Trash2 aria-hidden="true" /> Remove
              </DialogTrigger>

              <DialogContent showCloseButton={false}>
                <DialogTitle>Remove {value.name}?</DialogTitle>
                <DialogDescription>
                  This removes the Plan grouping. Its Tests and Reports remain available.
                </DialogDescription>
                {remove.error ? (
                  <FieldError>
                    {remove.error instanceof Error
                      ? remove.error.message
                      : "Relay could not remove this Plan."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    className="relay-suite-remove-confirm"
                    variant="destructive"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? "Removing…" : "Remove Plan"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent
              showCloseButton={false}
              className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto"
            >
              <DialogTitle>Edit Plan</DialogTitle>
              <DialogDescription>
                Removing a Test from this Plan does not delete it.
              </DialogDescription>
              <form onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="edit-suite-name">Plan name</FieldLabel>
                  <Input
                    id="edit-suite-name"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </Field>
                <div className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto p-1">
                  <fieldset>
                    <legend>Tests</legend>
                    {editor.data?.tests.map((test) => (
                      <ChoiceLabel
                        key={test.id}
                        className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {test.name}
                          </span>
                          <span className="truncate text-xs leading-snug text-muted-foreground">
                            {productTestStatusLabel(test.status, test.name)}
                          </span>
                        </span>
                        <Checkbox
                          checked={testIds.has(test.id)}
                          onCheckedChange={(checked) =>
                            toggle(setTestIds, test.id, checked === true)
                          }
                        />
                      </ChoiceLabel>
                    ))}
                  </fieldset>
                  {editor.data?.dataSets.length ? (
                    <fieldset>
                      <legend>Data sets</legend>
                      {editor.data.dataSets.map((dataSet) => (
                        <ChoiceLabel
                          key={dataSet.id}
                          className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                        >
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="truncate text-sm font-medium text-foreground">
                              {dataSet.name}
                            </span>
                            <span className="truncate text-xs leading-snug text-muted-foreground">
                              {dataSet.optionCount} saved{" "}
                              {dataSet.optionCount === 1 ? "value" : "values"}
                            </span>
                          </span>
                          <Checkbox
                            checked={variableIds.has(dataSet.id)}
                            onCheckedChange={(checked) =>
                              toggle(setVariableIds, dataSet.id, checked === true)
                            }
                          />
                        </ChoiceLabel>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
                {save.error ? (
                  <FieldError>
                    {save.error instanceof Error
                      ? save.error.message
                      : "Relay could not save this Plan."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    type="submit"
                    variant="default"
                    disabled={!name.trim() || !testIds.size || save.isPending}
                  >
                    {save.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </LibraryPage>
  );
}
