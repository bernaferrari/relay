import { TestLibraryNavigation } from "../components/test-library-navigation";
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
import { Layers3, Plus, RotateCcw } from "lucide-react";
import { useDeferredValue, useState, type FormEvent } from "react";
import { SelectField } from "../components/filter-select";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { libraryRowSurface, libraryRowContent } from "../components/library-row-styles";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, ReadinessMark, RecoveryState } from "../components/product-patterns";
import { recordingQueryKeys } from "../data/recording-queries";
import { PageLoading } from "./recording-shared";
import { productLinkClassName } from "../lib/class-names";

const SUITES_QUERY_KEY = ["suites"] as const;
const routeApi = getRouteApi("/suites");

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

export function SuitesPage() {
  const { suiteProfileService, productService, queryClient } = useRouteContext({
    from: "__root__",
  });
  const navigate = useNavigate({ from: "/suites" });
  const search = routeApi.useSearch() as { app?: unknown; q?: unknown };
  const requestedApp = typeof search.app === "string" ? search.app : "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [testQuery, setTestQuery] = useState("");
  const [testIds, setTestIds] = useState<Set<string>>(() => new Set());
  const [variableIds, setVariableIds] = useState<Set<string>>(() => new Set());
  const suites = useQuery({
    queryKey: [...SUITES_QUERY_KEY, requestedApp || "all"],
    queryFn: () => suiteProfileService.listSuites(requestedApp || undefined),
    staleTime: 15_000,
  });
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
        strategy: "cartesian",
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
  const query = typeof search.q === "string" ? search.q : "";
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleSuites = (suites.data ?? []).filter((suite) =>
    `${suite.name} ${suite.appName}`.toLocaleLowerCase().includes(deferredQuery),
  );

  function resetCreate() {
    const requestedApp = typeof search.app === "string" ? search.app : undefined;
    setAppId(
      apps.data?.some((app) => app.id === requestedApp)
        ? requestedApp!
        : (apps.data?.[0]?.id ?? ""),
    );
    setName("");
    setTestQuery("");
    setTestIds(new Set());
    setVariableIds(new Set());
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
    createSuite.mutate();
  }

  return (
    <LibraryPage className="max-w-5xl">
      <PageHeader
        title="Tests"
        description="A test plan groups existing tests to run together. You don’t need a plan to run an individual test."
        actions={
          <>
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                if (!open && createSuite.isPending) return;
                setDialogOpen(open);
                if (open) resetCreate();
              }}
            >
              <DialogTrigger render={<Button variant="default" disabled={!apps.data?.length} />}>
                <Plus aria-hidden="true" /> New test plan
              </DialogTrigger>

              <DialogContent
                showCloseButton={false}
                className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto"
              >
                <DialogTitle>New test plan</DialogTitle>
                <DialogDescription>
                  Choose existing tests for this plan. Their steps stay in the original tests; you
                  choose devices and accounts when you run the plan.
                </DialogDescription>
                <form onSubmit={submit}>
                  <Field>
                    <SelectField
                      id="suite-app"
                      label="App"
                      placeholder="Choose an App"
                      value={appId}
                      options={(apps.data ?? []).map((app) => ({
                        value: app.id,
                        label: app.name,
                      }))}
                      onValueChange={(value) => {
                        setAppId(value);
                        setTestIds(new Set());
                        setVariableIds(new Set());
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
                            test.name
                              .toLocaleLowerCase()
                              .includes(testQuery.trim().toLocaleLowerCase()),
                          ) ? (
                            <p className="p-3 text-sm text-muted-foreground">
                              No Tests match your search. Your selection is preserved.
                            </p>
                          ) : null}
                          {editor.data.tests
                            .filter((test) =>
                              test.name
                                .toLocaleLowerCase()
                                .includes(testQuery.trim().toLocaleLowerCase()),
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
                        </div>
                      </fieldset>
                      {editor.data.dataSets.length ? (
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
                        <Button variant="ghost" disabled={createSuite.isPending}>
                          Cancel
                        </Button>
                      }
                    />
                    <Button
                      type="submit"
                      variant="default"
                      disabled={
                        !editor.data || !name.trim() || !testIds.size || createSuite.isPending
                      }
                    >
                      {createSuite.isPending ? "Saving…" : "Save Plan"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <TestLibraryNavigation active="plans" app={requestedApp} />

      {suites.isPending || apps.isPending ? <PageLoading label="Loading Plans…" /> : null}
      {suites.error || apps.error ? (
        <RecoveryState
          layout="centered"
          title="Plans are unavailable"
          detail="Reconnect Relay, then try again."
          action={
            <Button
              variant="outline"
              onClick={() => {
                void suites.refetch();
                void apps.refetch();
              }}
            >
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {!suites.isPending && !suites.error && suites.data ? (
        <>
          <LibraryToolbar
            label="Filter Plans"
            search={
              <LibrarySearch
                id="plan-search"
                label="Search Plans"
                placeholder="Search by Plan or app"
                value={query}
                onChange={(q) =>
                  void navigate({
                    search: (previous) => ({ ...previous, q: q || undefined }),
                    replace: true,
                  })
                }
              />
            }
          />
          <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <h2 className="font-semibold">
              {visibleSuites.length} {visibleSuites.length === 1 ? "Plan" : "Plans"}
            </h2>
          </div>
          {suites.data.length > 0 && visibleSuites.length === 0 ? (
            <EmptyState
              title="No Plans match"
              detail="Try another name or app."
              action={
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigate({
                      search: (previous) => ({ ...previous, q: undefined }),
                      replace: true,
                    })
                  }
                >
                  Clear search
                </Button>
              }
            />
          ) : null}
          <ul
            className="m-0 list-none overflow-hidden rounded-xl border border-border/60 p-0 [&>li+li]:border-t [&>li+li]:border-border/60 empty:hidden"
            aria-label="Plans"
          >
            {visibleSuites.map((suite) => {
              const needsReview = suite.tests.some((test) => test.status === "needs-review");
              return (
                <li key={`${suite.appMapId}:${suite.id}`}>
                  <Link
                    className={`${libraryRowSurface} ${libraryRowContent} grid-cols-[auto_minmax(0,1fr)] gap-3`}
                    to="/apps/$appId/suites/$suiteId"
                    params={{ appId: suite.appMapId, suiteId: suite.id }}
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center text-muted-foreground"
                      aria-hidden="true"
                    >
                      <Layers3 />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <strong className="truncate text-sm font-semibold text-foreground">
                        {suite.name}
                      </strong>
                      <small className="truncate text-xs text-muted-foreground">
                        {suite.appName} · {suite.tests.length}{" "}
                        {suite.tests.length === 1 ? "Test" : "Tests"}
                        {suite.variableIds.length
                          ? ` · ${suite.variableIds.length} Data ${suite.variableIds.length === 1 ? "set" : "sets"}`
                          : ""}
                      </small>
                      <span className="mt-1 flex items-center">
                        <ReadinessMark status={needsReview ? "needs-review" : "ready"} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {!suites.isPending && !suites.error && suites.data?.length === 0 ? (
        <EmptyState
          icon={Layers3}
          title={requestedApp ? "No Plans for this App" : "No Plans yet"}
          detail={
            requestedApp
              ? "Clear the App filter or create a Plan for this App."
              : "Group related Tests so you can run them together."
          }
          action={
            requestedApp ? (
              <Button
                variant="outline"
                onClick={() => void navigate({ search: { app: undefined } as never })}
              >
                Clear App filter
              </Button>
            ) : apps.data?.length ? (
              <Button
                variant="default"
                onClick={() => {
                  resetCreate();
                  setDialogOpen(true);
                }}
              >
                New test plan
              </Button>
            ) : (
              <Link className={productLinkClassName} to="/apps">
                Add an App first
              </Link>
            )
          }
        />
      ) : null}
    </LibraryPage>
  );
}
