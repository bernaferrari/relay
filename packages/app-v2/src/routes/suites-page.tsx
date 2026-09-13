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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Layers3, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { SelectField } from "../components/filter-select";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, ReadinessMark, RecoveryState } from "../components/product-patterns";
import { recordingQueryKeys } from "../data/recording-queries";
import { PageLoading } from "./recording-shared";

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
  const navigate = useNavigate();
  const search = routeApi.useSearch() as { app?: unknown };
  const requestedApp = typeof search.app === "string" ? search.app : "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
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
  const counts = useMemo(
    () => ({
      ready:
        suites.data?.filter((suite) => suite.tests.every((test) => test.status === "ready"))
          .length ?? 0,
      review:
        suites.data?.filter((suite) => suite.tests.some((test) => test.status === "needs-review"))
          .length ?? 0,
    }),
    [suites.data],
  );

  function resetCreate() {
    const requestedApp = typeof search.app === "string" ? search.app : undefined;
    setAppId(
      apps.data?.some((app) => app.id === requestedApp)
        ? requestedApp!
        : (apps.data?.[0]?.id ?? ""),
    );
    setName("");
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
    <LibraryPage className="max-w-[1080px]">
      <PageHeader
        context="Tests"
        title="Plans"
        description="Groups of Tests you can run together every day."
        actions={
          <>
            <nav className="flex items-center gap-1 text-sm" aria-label="Library">
              <Link
                className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
                to="/tests"
                search={requestedApp ? { app: requestedApp } : {}}
              >
                Tests
              </Link>
              <span className="rounded-md bg-muted px-2 py-1 font-semibold">Plans</span>
            </nav>
            <Button nativeButton={false} render={<Link to="/environments" />} variant="outline">
              Browsers
            </Button>
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                if (!open && createSuite.isPending) return;
                setDialogOpen(open);
                if (open) resetCreate();
              }}
            >
              <DialogTrigger render={<Button variant="default" disabled={!apps.data?.length} />}>
                <Plus aria-hidden="true" /> New Plan
              </DialogTrigger>

              <DialogContent
                showCloseButton={false}
                className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto"
              >
                <DialogTitle>New Plan</DialogTitle>
                <DialogDescription>
                  Choose an App, then pick the Tests to run together.
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
                    <div className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto p-1">
                      <fieldset>
                        <legend>Tests</legend>
                        {editor.data.tests.map((test) => (
                          <ChoiceLabel
                            key={test.id}
                            className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                          >
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="truncate text-sm font-medium text-foreground">
                                {test.name}
                              </span>
                              <span className="truncate text-xs leading-snug text-muted-foreground">
                                {test.status === "ready" ? "Ready" : "Unbound"}
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
                  <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
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
          <SelectField
            className="mb-5 max-w-xs"
            label="App"
            value={requestedApp || "all-apps"}
            options={[
              { value: "all-apps", label: "All apps" },
              ...(apps.data ?? []).map((app) => ({ value: app.id, label: app.name })),
            ]}
            onValueChange={(value) =>
              void navigate({
                search: { app: value === "all-apps" ? undefined : value } as never,
              })
            }
          />
          <dl
            className="my-7 grid grid-cols-3 border-y border-border py-4 max-[560px]:grid-cols-1"
            aria-label="Plan status"
          >
            <div>
              <dt>Saved</dt>
              <dd>{suites.data.length}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{counts.ready}</dd>
            </div>
            <div>
              <dt>Unbound</dt>
              <dd>{counts.review}</dd>
            </div>
          </dl>
          <ul className="mt-5 grid list-none gap-2.5 p-0" aria-label="Plans">
            {suites.data.map((suite) => {
              const needsReview = suite.tests.some((test) => test.status === "needs-review");
              return (
                <li key={`${suite.appMapId}:${suite.id}`}>
                  <Link
                    className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-[-2px]"
                    to="/apps/$appId/suites/$suiteId"
                    params={{ appId: suite.appMapId, suiteId: suite.id }}
                  >
                    <span
                      className="grid size-[38px] place-items-center rounded-md border border-border bg-muted text-muted-foreground"
                      aria-hidden="true"
                    >
                      <Layers3 />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
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
                    </span>
                    <span className="ml-auto shrink-0">
                      <ReadinessMark status={needsReview ? "needs-review" : "ready"} />
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
              <Button variant="default" onClick={() => setDialogOpen(true)}>
                New Plan
              </Button>
            ) : (
              <Link
                className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                to="/apps"
              >
                Add an App first
              </Link>
            )
          }
        />
      ) : null}
    </LibraryPage>
  );
}
