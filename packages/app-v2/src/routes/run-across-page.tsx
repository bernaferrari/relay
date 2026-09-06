/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { FormPage, PageHeader } from "../components/page-layout";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { useRunConfigurationKey } from "../data/use-persisted-run-configuration";
import { usePersistedRunConfiguration } from "../data/use-persisted-run-configuration";
import { compileRepeatScope } from "../data/paired-configuration";
import { usePairedConfigurationWorkspace } from "../data/use-paired-configuration-workspace";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/run-across");

export function RunAcrossPage() {
  const { runAcrossService, runService, platform } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const navigate = useNavigate();
  const setup = useQuery({
    queryKey: ["run-across", "setup", testId],
    queryFn: async () => {
      const test = await runService.getTest(testId);
      if (!test) throw new TypeError("This Test is not available.");
      return runAcrossService.getSetup(test.appMapId, testId);
    },
    staleTime: 15_000,
  });
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
  });
  const scope = useRunConfigurationKey(platform, `test:${testId}`, setup.data?.appMapId);
  const configuration = usePersistedRunConfiguration({
    storage: platform.storage,
    key: scope.key,
    targetOptions: targets.data?.map((item) => ({ id: item.targetId, label: item.name })),
  });
  const targetId = configuration.selection.targetProfileId ?? "";
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
  const selectionReady = Boolean(
    setup.data && !valuesUnavailable && missingDimensions.length === 0,
  );
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const target = useMemo(
    () => targets.data?.find((item) => item.targetId === targetId),
    [targetId, targets.data],
  );
  const runTarget = useMemo(
    () => (target ? { ...target, label: target.name } : undefined),
    [target],
  );
  const paired = usePairedConfigurationWorkspace(platform);
  const previewResult = useMemo(() => {
    if (!setup.data || !runTarget || !selectionReady)
      return { preview: undefined, error: undefined };
    try {
      const preview = runAcrossService.preview({
        setup: setup.data,
        selected,
        target: runTarget,
      });
      if (configuration.selection.usePairedWorkspace) {
        const scope = compileRepeatScope({
          workspace: paired.workspace,
          dataCaseCount: preview.caseCount,
        });
        return {
          preview: { ...preview, caseCount: scope.executionCount, scopeLabel: scope.scopeLabel },
          error: undefined,
        };
      }
      return { preview, error: undefined };
    } catch (error) {
      return { preview: undefined, error: errorMessage(error) };
    }
  }, [
    configuration.selection.usePairedWorkspace,
    paired.workspace,
    previewAttempt,
    runAcrossService,
    selected,
    setup.data,
    runTarget,
    selectionReady,
  ]);
  const preview = previewResult.preview;
  const start = useMutation({
    mutationFn: () => {
      if (!setup.data || !runTarget || configuration.loading || !preview) {
        throw new TypeError("Choose a ready device or browser and at least one data value.");
      }
      const pilotTargetId = configuration.selection.usePairedWorkspace
        ? paired.workspace.rows[0]?.browserId
        : runTarget.targetId;
      const target = targets.data?.find((item) => item.targetId === pilotTargetId) ?? runTarget;
      return runAcrossService.startPilot({
        setup: setup.data,
        selected,
        target: { ...target, label: target.name },
      });
    },
    onSuccess: async (batch) => {
      await navigate({ to: "/batches/$batchId", params: { batchId: batch.id } });
    },
  });

  const loading = setup.isPending || targets.isPending;
  return (
    <FormPage>
      <PageHeader
        crumbs={[
          { label: "Tests", to: "/tests" },
          { label: setup.data?.testName ?? "Test" },
          { label: "Run with data" },
        ]}
        title="Choose data and where to run"
        description="Run one selected case first, then review its Report before continuing with the rest."
      />
      {loading ? <PageLoading label="Loading saved data and available devices…" /> : null}
      <RecordingProblem
        error={setup.error ?? targets.error ?? start.error ?? previewResult.error}
        onRetry={() => {
          void setup.refetch();
          void targets.refetch();
          setPreviewAttempt((attempt) => attempt + 1);
        }}
        retrying={setup.isFetching || targets.isFetching}
      />
      {!loading && setup.data && !setup.error ? (
        <div className="grid gap-6">
          <RunConfigurationComposer
            configuration={{
              values: {
                targetProfileId: target?.targetId,
                targetName: target?.name,
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
                : previewResult.error
                  ? [
                      {
                        id: "preview",
                        label: "Configuration unavailable",
                        detail: previewResult.error,
                      },
                    ]
                  : configuration.targetUnavailable
                    ? [
                        {
                          id: "target",
                          label: "Saved device is unavailable",
                          detail: "Choose another device or browser to continue.",
                        },
                      ]
                    : !target
                      ? [{ id: "target", label: "Choose a ready device or browser" }]
                      : !selectionReady
                        ? [
                            {
                              id: "values",
                              label: "Choose values for the remaining data groups",
                              detail: missingDimensions
                                .map((dimension) => dimension.name)
                                .join(", "),
                            },
                          ]
                        : [],
              validated: Boolean(preview),
            }}
            targetOptions={targets.data?.map((item) => ({
              id: item.targetId,
              label: item.name,
              detail: item.detail,
            }))}
            dataSetOptions={setup.data.dataSet.dimensions.flatMap((dimension) =>
              dimension.values.map((value) => ({
                id: JSON.stringify([dimension.id, value.id]),
                label: `${dimension.name}: ${value.label}`,
                detail: value.detail,
              })),
            )}
            selection={configuration.selection}
            onSelectionChange={configuration.setSelection}
            loading={configuration.loading}
            error={scope.error ?? configuration.error}
            onRetry={scope.error ? scope.retry : configuration.retry}
            targetGroupName="run-across-target"
            pairedWorkspaceLabel={
              paired.workspace.rows.length
                ? `Use saved workspace · ${paired.workspace.rows.length} paired configurations`
                : undefined
            }
          >
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
            {preview ? (
              <div
                className="my-5 grid gap-1 rounded-lg border border-border bg-background p-3.5"
                role="status"
              >
                <strong>Ready to start</strong>
                <span>{preview.scopeLabel}</span>
                <small>
                  Relay starts with one representative case and pauses for review before the rest.
                </small>
              </div>
            ) : (
              <p className="relay-action-hint mt-3 text-sm leading-relaxed text-muted-foreground">
                {target && missingDimensions.length
                  ? "Choose at least one value in each data group."
                  : "Choose at least one value and one ready device or browser."}
              </p>
            )}
            <Button
              variant="default"
              onClick={() => start.mutate()}
              disabled={!preview || start.isPending || configuration.loading}
            >
              {start.isPending ? "Starting first case…" : "Run first case"}
            </Button>
          </RunConfigurationComposer>
        </div>
      ) : null}
    </FormPage>
  );
}
