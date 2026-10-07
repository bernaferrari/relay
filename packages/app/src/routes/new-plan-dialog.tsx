/** @jsxImportSource react */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
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
import { Layers3 } from "lucide-react";
import { SelectField } from "../components/filter-select";
import { recordingQueryKeys } from "../data/recording-queries";
import { PageLoading } from "./recording-shared";
import { PlanInputDataSetPicker } from "./plan-input-data-set-picker";
import type { ProductSuiteTest } from "../data/suite-profile-product-service";

const SUITES_QUERY_KEY = ["suites"] as const;

function TestChoiceDetails({ test }: { test: ProductSuiteTest }) {
  const updated = new Date(test.updatedAt ?? NaN);
  const hasUpdated = Number.isFinite(updated.getTime()) && (test.updatedAt ?? 0) > 0;
  const details = [
    test.stepCount !== undefined
      ? `${test.stepCount} ${test.stepCount === 1 ? "step" : "steps"}`
      : "",
    hasUpdated
      ? `Updated ${updated.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
      : "",
    test.status === "needs-review" ? productTestStatusLabel(test.status, test.name) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="truncate text-xs leading-snug text-muted-foreground"
      title={hasUpdated ? updated.toLocaleString() : undefined}
    >
      {details}
    </span>
  );
}

function suiteIdFor(name: string): string {
  const stem = name
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 32);
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36);
  return `suite-${stem || "coverage"}-${suffix}`;
}

/** Group existing tests into a plan you can run together (and schedule). */
export function NewPlanDialog({ appId: requestedApp = "" }: { appId?: string }) {
  const { suiteProfileService, productService, queryClient } = useRouteContext({
    from: "__root__",
  });
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [testQuery, setTestQuery] = useState("");
  const [testIds, setTestIds] = useState<Set<string>>(() => new Set());
  const [variableIds, setVariableIds] = useState<Set<string>>(() => new Set());
  const [selectedOptions, setSelectedOptions] = useState<Record<string, readonly string[]>>({});
  const [addingDataSet, setAddingDataSet] = useState(false);
  const [strategy, setStrategy] = useState<"cartesian" | "zip">("cartesian");
  const [referenceReviewMode, setReferenceReviewMode] = useState<"human" | "approved-reference">(
    "human",
  );
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    staleTime: 15_000,
  });
  const editor = useQuery({
    queryKey: ["suites", "editor", appId],
    queryFn: () => suiteProfileService.getSuiteEditor(appId),
    enabled: dialogOpen && Boolean(appId),
    staleTime: 15_000,
  });
  const createSuite = useMutation({
    mutationFn: async () => {
      if (!editor.data) throw new TypeError("Choose an App before saving this Plan.");
      return suiteProfileService.saveSuite({
        appMapId: editor.data.appMapId,
        suiteId: suiteIdFor(name),
        expectedRevision: editor.data.revision,
        name,
        testIds: [...testIds],
        variableIds: [...variableIds],
        ...(Object.keys(selectedOptions).length ? { selected: selectedOptions } : {}),
        strategy,
        referenceReviewMode,
      });
    },
    onSuccess: async (suite) => {
      await queryClient.invalidateQueries({ queryKey: SUITES_QUERY_KEY });
      setDialogOpen(false);
      await navigate({
        to: "/apps/$appId/suites/$suiteId",
        params: { appId: suite.appMapId, suiteId: suite.id },
      });
    },
  });

  function resetCreate() {
    setAppId(
      apps.data?.some((app) => app.id === requestedApp) ? requestedApp : (apps.data?.[0]?.id ?? ""),
    );
    setName("");
    setTestQuery("");
    setTestIds(new Set());
    setVariableIds(new Set());
    setSelectedOptions({});
    setAddingDataSet(false);
    setStrategy("cartesian");
    setReferenceReviewMode("human");
    createSuite.reset();
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
    if (addingDataSet || createSuite.isPending) return;
    createSuite.mutate();
  }

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open && (createSuite.isPending || addingDataSet)) return;
        setDialogOpen(open);
        if (open) resetCreate();
      }}
    >
      <DialogTrigger render={<Button variant="outline" disabled={!apps.data?.length} />}>
        <Layers3 aria-hidden="true" /> New plan
      </DialogTrigger>

      <DialogContent
        showCloseButton={false}
        className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto sm:max-w-180"
      >
        <DialogTitle>New test plan</DialogTitle>
        <DialogDescription>
          Group Tests and choose prompts to repeat. Choose devices and accounts when you run the
          Plan.
        </DialogDescription>
        <form onSubmit={submit}>
          <Field>
            <SelectField
              id="suite-app"
              label="App"
              placeholder="Choose an App"
              value={appId}
              disabled={addingDataSet || createSuite.isPending}
              options={(apps.data ?? []).map((app) => ({
                value: app.id,
                label: app.name,
              }))}
              onValueChange={(value) => {
                setAppId(value);
                setTestIds(new Set());
                setVariableIds(new Set());
                setSelectedOptions({});
                setStrategy("cartesian");
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="suite-name">Plan name</FieldLabel>
            <Input
              id="suite-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="For example, Release smoke"
              autoComplete="off"
            />
          </Field>
          <Field>
            <SelectField
              label="Screenshot review"
              value={referenceReviewMode}
              options={[
                { value: "human", label: "Capture for human review" },
                { value: "approved-reference", label: "Compare approved references" },
              ]}
              onValueChange={(value) =>
                setReferenceReviewMode(value === "approved-reference" ? value : "human")
              }
            />
            <p className="text-xs text-muted-foreground">
              {referenceReviewMode === "approved-reference"
                ? "Matching approved reference images are marked automatically. Accept as reference explicitly chooses the image for later Runs."
                : "Every captured image waits for a person. Looks correct does not create a future reference."}
            </p>
          </Field>
          {editor.isPending && appId ? <PageLoading label="Loading App Tests…" /> : null}
          {editor.error ? (
            <FieldError>
              Relay could not load this App’s Plan editor.{" "}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void editor.refetch()}
                disabled={editor.isFetching}
              >
                {editor.isFetching ? "Retrying…" : "Try again"}
              </Button>
            </FieldError>
          ) : null}
          {editor.data ? (
            <div className="grid min-w-0 gap-5">
              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  Tests · {testIds.size} selected
                </legend>
                <Input
                  aria-label="Search Tests for this Plan"
                  placeholder="Find a Test…"
                  value={testQuery}
                  onChange={(event) => setTestQuery(event.currentTarget.value)}
                  className="mb-3"
                />
                <div className="grid max-h-64 gap-2 overflow-y-auto p-1">
                  {!editor.data.tests.some((test) =>
                    test.name.toLocaleLowerCase().includes(testQuery.trim().toLocaleLowerCase()),
                  ) ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      No Tests match your search. Your selection is preserved.
                    </p>
                  ) : null}
                  {editor.data.tests
                    .filter((test) =>
                      test.name.toLocaleLowerCase().includes(testQuery.trim().toLocaleLowerCase()),
                    )
                    .map((test) => (
                      <ChoiceLabel
                        key={test.id}
                        className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {test.name}
                          </span>
                          <TestChoiceDetails test={test} />
                        </span>
                        <Checkbox
                          disabled={addingDataSet || createSuite.isPending}
                          checked={testIds.has(test.id)}
                          onCheckedChange={(checked) =>
                            toggle(setTestIds, test.id, checked === true)
                          }
                        />
                      </ChoiceLabel>
                    ))}
                </div>
              </fieldset>
              {editor.data.dataSets.length || suiteProfileService.listInputDataSets ? (
                <fieldset>
                  <legend className="mb-3 text-sm font-medium">Data sets</legend>
                  <div className="grid gap-2">
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
                            {variableIds.has(dataSet.id) && selectedOptions[dataSet.id]
                              ? `${selectedOptions[dataSet.id]!.length} of ${dataSet.optionCount} values selected`
                              : `${dataSet.optionCount} saved ${dataSet.optionCount === 1 ? "value" : "values"}`}
                          </span>
                        </span>
                        <Checkbox
                          disabled={addingDataSet || createSuite.isPending}
                          checked={variableIds.has(dataSet.id)}
                          onCheckedChange={(checked) =>
                            toggle(setVariableIds, dataSet.id, checked === true)
                          }
                        />
                      </ChoiceLabel>
                    ))}
                    {suiteProfileService.listInputDataSets &&
                    suiteProfileService.addInputDataSet ? (
                      <PlanInputDataSetPicker
                        key={appId}
                        appMapId={appId}
                        revision={editor.data.revision}
                        service={{
                          listInputDataSets: suiteProfileService.listInputDataSets,
                          addInputDataSet: suiteProfileService.addInputDataSet,
                          saveInputDefinition: suiteProfileService.saveInputDefinition,
                          previewInputBindings: suiteProfileService.previewInputBindings,
                        }}
                        selectedTests={editor.data.tests.filter((test) => testIds.has(test.id))}
                        disabled={createSuite.isPending}
                        onBusy={setAddingDataSet}
                        onReload={() => editor.refetch()}
                        onAdded={({ editor: saved, variableId, selectedOptionIds }) => {
                          queryClient.setQueryData(["suites", "editor", appId], saved);
                          toggle(setVariableIds, variableId, true);
                          if (selectedOptionIds)
                            setSelectedOptions((current) => ({
                              ...current,
                              [variableId]: selectedOptionIds,
                            }));
                        }}
                      />
                    ) : null}
                    {variableIds.size > 1 ? (
                      <SelectField
                        label="Combine values"
                        value={strategy}
                        options={[
                          { value: "cartesian", label: "Every combination" },
                          { value: "zip", label: "Pair values in order" },
                        ]}
                        onValueChange={(value) =>
                          setStrategy(value === "zip" ? "zip" : "cartesian")
                        }
                      />
                    ) : null}
                  </div>
                </fieldset>
              ) : null}
            </div>
          ) : null}
          {createSuite.error ? (
            <FieldError>
              {createSuite.error instanceof Error
                ? createSuite.error.message
                : "Relay could not save this Plan."}
            </FieldError>
          ) : null}
          <div className="sticky bottom-0 border-t border-border bg-background pt-4 flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose
              render={
                <Button variant="ghost" disabled={createSuite.isPending || addingDataSet}>
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              variant="default"
              disabled={
                !editor.data ||
                !name.trim() ||
                !testIds.size ||
                createSuite.isPending ||
                addingDataSet
              }
            >
              {createSuite.isPending ? "Saving…" : "Save Plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
