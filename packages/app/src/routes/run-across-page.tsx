/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { EmptyState } from "../components/product-patterns";
import { FormPage, PageHeader } from "../components/page-layout";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { useRunConfigurationKey } from "../data/use-persisted-run-configuration";
import { usePersistedRunConfiguration } from "../data/use-persisted-run-configuration";
import { usePairedConfigurationWorkspace } from "../data/use-paired-configuration-workspace";
import { admitPairedTestStarts } from "../data/paired-configuration";
import { profileTargetsFromStarts } from "../data/start-owned-test-run";
import { productLinkClassName } from "../lib/class-names";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/run-across");

function existingBatchId(error: unknown): string | undefined {
  const body = (error as { body?: { code?: unknown; repeatId?: unknown } } | null)?.body;
  if (body?.code === "ACTIVE_REPEAT_EXISTS" && typeof body.repeatId === "string")
    return body.repeatId;
  const message = error instanceof Error ? error.message : "";
  return /\bBatch ([0-9a-f-]{36}) was created; inspect it in Runs\./iu.exec(message)?.[1];
}

export function RunAcrossPage() {
  const { runAcrossService, runService, platform } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const search = routeApi.useSearch() as Record<string, unknown>;
  const appScope = typeof search.app === "string" && search.app ? search.app : undefined;
  const navigate = useNavigate();
  const setup = useQuery({
    queryKey: ["run-across", "setup", appScope ?? null, testId],
    queryFn: async () => {
      const test = await runService.getTest(testId, appScope);
      if (!test) throw new TypeError("This test is not available.");
      return runAcrossService.getSetup(test.appMapId, testId);
    },
    staleTime: 15_000,
  });
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
  });
  const profiles = useQuery({
    queryKey: ["run-config", "profiles", setup.data?.appMapId],
    queryFn: () => runService.listProfiles?.(setup.data!.appMapId) ?? Promise.resolve([]),
    enabled: Boolean(setup.data?.appMapId && runService.listProfiles),
    staleTime: 15_000,
  });
  const paired = usePairedConfigurationWorkspace(platform);
  const scope = useRunConfigurationKey(platform, `test:${testId}`, setup.data?.appMapId);
  const configuration = usePersistedRunConfiguration({
    storage: platform.storage,
    key: scope.key,
    targetOptions: targets.data?.map((item) => ({ id: item.targetId, label: item.name })),
  });
  const targetId = configuration.selection.targetProfileId ?? "";
  const usePairs = configuration.selection.usePairedWorkspace === true;
  const availableValues = new Set(
    (setup.data?.dataSet.dimensions ?? []).flatMap((dimension) =>
      dimension.values.map((value) => JSON.stringify([dimension.id, value.id])),
    ),
  );
  const unavailableValues = (configuration.selection.dataSetIds ?? []).filter(
    (id) => !availableValues.has(id),
  );
  const valuesUnavailable = Boolean(setup.data && unavailableValues.length);
  const selected = useMemo(() => {
    const chosen = new Set(configuration.selection.dataSetIds ?? []);
    return Object.fromEntries(
      (setup.data?.dataSet.dimensions ?? []).map((dimension) => [
        dimension.id,
        dimension.values
          .filter((value) => chosen.has(JSON.stringify([dimension.id, value.id])))
          .map((value) => value.id),
      ]),
    );
  }, [configuration.selection.dataSetIds, setup.data]);
  const missingDimensions = useMemo(
    () =>
      (setup.data?.dataSet.dimensions ?? []).filter(
        (dimension) => (selected[dimension.id] ?? []).length === 0,
      ),
    [selected, setup.data],
  );
  const hasDataValues = Boolean(
    setup.data && setup.data.dataSet.dimensions.every((dimension) => dimension.values.length > 0),
  );
  const selectionReady = Boolean(
    setup.data && hasDataValues && !valuesUnavailable && missingDimensions.length === 0,
  );
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const pairResult = useMemo(() => {
    if (!usePairs || !setup.data || paired.loading || (profiles.isEnabled && profiles.isPending)) {
      return { profileTargets: undefined, error: undefined };
    }
    if (!runService.listProfiles || profiles.error) {
      return {
        profileTargets: undefined,
        error: "Saved Browser profiles are unavailable. Retry when Relay reconnects.",
      };
    }
    if (paired.error) return { profileTargets: undefined, error: paired.error };
    try {
      const admitted = admitPairedTestStarts({
        testId,
        appMapId: setup.data.appMapId,
        workspace: paired.workspace,
        profiles: profiles.data,
      });
      const blocked = admitted.flatMap((item) =>
        item.status === "blocked" ? [`${item.configuration.name}: ${item.reason}`] : [],
      );
      if (blocked.length) return { profileTargets: undefined, error: blocked.join("; ") };
      const requests = admitted.flatMap((item) => (item.status === "ready" ? [item.request] : []));
      if (!requests.length)
        return { profileTargets: undefined, error: "Save at least one browser sign-in first." };
      return { profileTargets: profileTargetsFromStarts(requests), error: undefined };
    } catch (error) {
      return { profileTargets: undefined, error: errorMessage(error) };
    }
  }, [
    usePairs,
    setup.data,
    paired.loading,
    paired.error,
    paired.workspace,
    profiles.data,
    profiles.error,
    profiles.isEnabled,
    profiles.isPending,
    runService.listProfiles,
    testId,
  ]);
  const target = useMemo(
    () => targets.data?.find((item) => item.targetId === targetId),
    [targetId, targets.data],
  );
  const runTarget = useMemo(
    () =>
      usePairs
        ? pairResult.profileTargets?.[0]
          ? {
              kind: "browser" as const,
              platform: "browser" as const,
              targetId: pairResult.profileTargets[0].target.browserTargetId,
              label: "Saved browser sign-ins",
            }
          : undefined
        : target
          ? { ...target, label: target.name }
          : undefined,
    [target, usePairs, pairResult.profileTargets],
  );
  const previewResult = useMemo(() => {
    if (
      !setup.data ||
      !runTarget ||
      !selectionReady ||
      configuration.loading ||
      configuration.error ||
      scope.error
    )
      return { preview: undefined, error: undefined };
    if (!setup.data.dataSet.dimensions.length && !usePairs) {
      return {
        preview: undefined,
        error: "Choose saved browser sign-ins here, or run once from the test page.",
      };
    }
    try {
      const preview = runAcrossService.preview({
        setup: setup.data,
        selected,
        target: runTarget,
        ...(usePairs ? { profileTargets: pairResult.profileTargets } : {}),
      });
      return { preview, error: undefined };
    } catch (error) {
      return { preview: undefined, error: errorMessage(error) };
    }
  }, [
    previewAttempt,
    runAcrossService,
    selected,
    setup.data,
    runTarget,
    selectionReady,
    configuration.loading,
    configuration.error,
    scope.error,
    usePairs,
    pairResult.profileTargets,
  ]);
  const preview = previewResult.preview;
  const start = useMutation({
    mutationFn: () => {
      if (
        !setup.data ||
        !runTarget ||
        configuration.loading ||
        configuration.error ||
        scope.error ||
        paired.loading ||
        !preview ||
        (usePairs && (!pairResult.profileTargets?.length || pairResult.error || profiles.error))
      ) {
        throw new TypeError("Choose a ready device or browser and resolve the saved data choices.");
      }
      return runAcrossService.startPilot({
        setup: setup.data,
        selected,
        target: runTarget,
        executionMode: "all",
        ...(usePairs && pairResult.profileTargets
          ? { profileTargets: pairResult.profileTargets }
          : {}),
      });
    },
    onSuccess: async (batch) => {
      await navigate({ to: "/batches/$batchId", params: { batchId: batch.id } });
    },
  });
  const savedBatchId = existingBatchId(start.error);

  const loading =
    setup.isPending ||
    paired.loading ||
    (usePairs ? profiles.isEnabled && profiles.isPending : targets.isPending);
  return (
    <FormPage className="!pb-4">
      <PageHeader
        crumbs={[
          { label: "Tests", to: "/tests", search: { app: setup.data?.appMapId ?? appScope } },
          {
            label: setup.data?.testName ?? "Test",
            to: "/tests/$testId",
            params: { testId },
            search: { app: setup.data?.appMapId ?? appScope },
          },
          { label: "Run across" },
        ]}
        title={setup.data ? `Run across · ${setup.data.testName}` : "Run across"}
        description="Run this test once for each combination you pick, then compare the results."
      />
      {loading ? <PageLoading label="Loading…" /> : null}
      <RecordingProblem
        error={
          setup.error ??
          (usePairs ? (profiles.error ?? paired.error) : targets.error) ??
          previewResult.error
        }
        onRetry={() => {
          void setup.refetch();
          void targets.refetch();
          void profiles.refetch();
          paired.retry();
          setPreviewAttempt((attempt) => attempt + 1);
        }}
        retrying={setup.isFetching || (usePairs ? profiles.isFetching : targets.isFetching)}
      />
      {!loading && setup.data && !setup.error && !hasDataValues ? (
        <EmptyState
          title="This data set has no values yet"
          detail="Add values to the app's saved data set before running across them. You can still run this test once."
          action={
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/tests/$testId"
                  params={{ testId }}
                  search={{ setup: "run", app: setup.data.appMapId }}
                />
              }
            >
              Run this test once
            </Button>
          }
        />
      ) : null}
      {!loading && setup.data && !setup.error && hasDataValues ? (
        <div className="grid gap-6">
          <RunConfigurationComposer
            title={null}
            configuration={{
              values: {
                targetProfileId: usePairs ? undefined : target?.targetId,
                targetName: usePairs ? `${paired.workspace.rows.length} saved pairs` : target?.name,
                dataSetName: setup.data.dataSet.name,
              },
              blockers: valuesUnavailable
                ? [
                    {
                      id: "values",
                      label: "Saved data values are unavailable",
                      detail: "Remove unavailable choices, then select the values you want to run.",
                    },
                  ]
                : pairResult.error
                  ? [
                      {
                        id: "pairs",
                        label: "Saved sign-ins unavailable",
                        detail: pairResult.error,
                      },
                    ]
                  : previewResult.error
                    ? [
                        {
                          id: "preview",
                          label: "Configuration unavailable",
                          detail: previewResult.error,
                        },
                      ]
                    : !usePairs && configuration.targetUnavailable
                      ? [
                          {
                            id: "target",
                            label: "Saved device is unavailable",
                            detail: "Choose another device or browser to continue.",
                          },
                        ]
                      : [],
              validated: Boolean(preview),
            }}
            targetOptions={
              usePairs
                ? undefined
                : targets.data?.map((item) => ({
                    id: item.targetId,
                    label: item.name,
                    detail: item.detail,
                  }))
            }
            dataSetOptions={setup.data.dataSet.dimensions.flatMap((dimension) =>
              dimension.values.map((value) => ({
                id: JSON.stringify([dimension.id, value.id]),
                label:
                  setup.data.dataSet.dimensions.length === 1
                    ? value.label
                    : `${dimension.name}: ${value.label}`,
                detail: value.detail,
                ...(dimension.kind === "language" ? { locale: value.id } : {}),
              })),
            )}
            selection={configuration.selection}
            onSelectionChange={configuration.setSelection}
            loading={configuration.loading}
            error={scope.error ?? configuration.error}
            onRetry={scope.error ? scope.retry : configuration.retry}
            targetGroupName="run-across-target"
            pairedWorkspaceLabel={
              // Offering an empty set of sign-ins is a dead end; Browsers is where they're made.
              paired.workspace.rows.length
                ? `Use saved browser sign-ins (${paired.workspace.rows.length})`
                : undefined
            }
            pairedWorkspaceAction={
              <Link className={productLinkClassName} to="/environments">
                Manage sign-ins
              </Link>
            }
          >
            {usePairs ? (
              <p className="text-sm text-muted-foreground">
                {paired.workspace.rows.map((row) => row.name).join(" · ") ||
                  "No saved sign-ins yet."}
              </p>
            ) : null}
            {valuesUnavailable ? (
              <Button
                variant="outline"
                onClick={() =>
                  configuration.setSelection({
                    ...configuration.selection,
                    dataSetIds: configuration.selection.dataSetIds?.filter((id) =>
                      availableValues.has(id),
                    ),
                  })
                }
              >
                Remove unavailable choices
              </Button>
            ) : null}
            {start.error ? (
              <div
                role="alert"
                className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                <p>
                  {start.error instanceof Error
                    ? start.error.message
                    : "Relay could not start these cases."}
                </p>
                {savedBatchId ? (
                  <p>The result is saved. Open it before starting another run.</p>
                ) : null}
              </div>
            ) : null}
            <footer className="sticky bottom-0 -mx-5 -mb-5 -mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-4">
              {preview ? (
                <div className="grid gap-1 text-sm" role="status">
                  <span>{preview.scopeLabel}</span>
                  <small className="text-muted-foreground">
                    Review all selected cases in one result.
                  </small>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {pairResult.error ??
                    previewResult.error ??
                    ((target || usePairs) && missingDimensions.length
                      ? `Choose a value for ${missingDimensions.map((dimension) => dimension.name).join(", ")}.`
                      : "Choose a device or browser to continue.")}
                </p>
              )}
              {!setup.data.dataSet.dimensions.length && !usePairs ? (
                <Link
                  className={productLinkClassName}
                  to="/tests/$testId"
                  params={{ testId }}
                  search={{ setup: "run", app: setup.data.appMapId }}
                >
                  Run once from test
                </Link>
              ) : null}
              {savedBatchId ? (
                <Button
                  nativeButton={false}
                  render={<Link to="/batches/$batchId" params={{ batchId: savedBatchId }} />}
                >
                  Open existing result
                </Button>
              ) : (
                <Button
                  variant="default"
                  onClick={() => start.mutate()}
                  disabled={!preview || start.isPending || configuration.loading || paired.loading}
                >
                  {start.isPending
                    ? "Starting…"
                    : !preview
                      ? "Run combinations"
                      : preview.caseCount === 1
                        ? "Run 1 combination"
                        : `Run ${preview.caseCount} combinations`}
                </Button>
              )}
            </footer>
          </RunConfigurationComposer>
        </div>
      ) : null}
    </FormPage>
  );
}
