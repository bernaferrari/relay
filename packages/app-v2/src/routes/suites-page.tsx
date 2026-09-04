/** @jsxImportSource react */
import {
  Button,
  CheckboxCard,
  Dialog,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Layers3, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, OutcomeMark, RecoveryState } from "../components/product-patterns";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [testIds, setTestIds] = useState<Set<string>>(() => new Set());
  const [variableIds, setVariableIds] = useState<Set<string>>(() => new Set());
  const suites = useQuery({
    queryKey: SUITES_QUERY_KEY,
    queryFn: () => suiteProfileService.listSuites(),
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
      if (!editor.data) throw new TypeError("Choose an App before saving this Suite.");
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
    <section className="relay-page relay-suites-page">
      <header className="relay-page-header relay-suites-header">
        <div>
          <p className="relay-eyebrow">Library</p>
          <h1>Suites</h1>
          <p className="relay-page-description">
            Save groups of Tests and Data sets, check their scope, and run them again with intent.
          </p>
        </div>
        <div className="relay-suites-actions">
          <Button render={<Link to="/environments" />} variant="secondary">
            Environments
          </Button>
          <Dialog.Root
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (open) resetCreate();
            }}
          >
            <Dialog.Trigger render={<Button variant="primary" disabled={!apps.data?.length} />}>
              <Plus aria-hidden="true" /> New Suite
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="relay-dialog-backdrop" />
              <Dialog.Viewport className="relay-dialog-viewport">
                <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-suite-dialog">
                  <Dialog.Title>New Suite</Dialog.Title>
                  <Dialog.Description>
                    Choose one App, then group the reviewed Tests and optional Data sets that belong
                    together.
                  </Dialog.Description>
                  <form onSubmit={submit}>
                    <Field>
                      <FieldLabel htmlFor="suite-app">App</FieldLabel>
                      <select
                        id="suite-app"
                        className="relay-native-select"
                        value={appId}
                        onChange={(event) => {
                          setAppId(event.currentTarget.value);
                          setTestIds(new Set());
                          setVariableIds(new Set());
                        }}
                      >
                        <option value="">Choose an App</option>
                        {apps.data?.map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="suite-name">Suite name</FieldLabel>
                      <Input
                        id="suite-name"
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        placeholder="For example, Release smoke"
                        autoComplete="off"
                      />
                    </Field>
                    {editor.isPending && appId ? <PageLoading label="Loading App Tests…" /> : null}
                    {editor.data ? (
                      <div className="relay-suite-dialog-scopes">
                        <fieldset>
                          <legend>Tests</legend>
                          {editor.data.tests.map((test) => (
                            <CheckboxCard
                              key={test.id}
                              checked={testIds.has(test.id)}
                              onCheckedChange={(checked) =>
                                toggle(setTestIds, test.id, checked === true)
                              }
                              title={test.name}
                              description={test.status === "ready" ? "Ready" : "Needs review"}
                            />
                          ))}
                        </fieldset>
                        {editor.data.dataSets.length ? (
                          <fieldset>
                            <legend>Data sets</legend>
                            {editor.data.dataSets.map((dataSet) => (
                              <CheckboxCard
                                key={dataSet.id}
                                checked={variableIds.has(dataSet.id)}
                                onCheckedChange={(checked) =>
                                  toggle(setVariableIds, dataSet.id, checked === true)
                                }
                                title={dataSet.name}
                                description={`${dataSet.optionCount} saved ${dataSet.optionCount === 1 ? "value" : "values"}`}
                              />
                            ))}
                          </fieldset>
                        ) : null}
                      </div>
                    ) : null}
                    {createSuite.error ? (
                      <FieldError>
                        {createSuite.error instanceof Error
                          ? createSuite.error.message
                          : "Relay could not save this Suite."}
                      </FieldError>
                    ) : null}
                    <div className="relay-dialog-actions">
                      <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={
                          !editor.data || !name.trim() || !testIds.size || createSuite.isPending
                        }
                      >
                        {createSuite.isPending ? "Saving…" : "Save Suite"}
                      </Button>
                    </div>
                  </form>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </header>

      {suites.isPending || apps.isPending ? <PageLoading label="Loading Suites…" /> : null}
      {suites.error || apps.error ? (
        <RecoveryState
          layout="centered"
          title="Suites are unavailable"
          detail="Reconnect Relay, then load the saved coverage plans again."
          action={
            <Button
              variant="secondary"
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
      {suites.data?.length ? (
        <>
          <dl className="relay-suite-facts" aria-label="Suite status">
            <div>
              <dt>Saved</dt>
              <dd>{suites.data.length}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{counts.ready}</dd>
            </div>
            <div>
              <dt>Needs review</dt>
              <dd>{counts.review}</dd>
            </div>
          </dl>
          <ul className="relay-suite-list" aria-label="Suites">
            {suites.data.map((suite) => {
              const needsReview = suite.tests.some((test) => test.status === "needs-review");
              return (
                <li key={`${suite.appMapId}:${suite.id}`}>
                  <Link
                    to="/apps/$appId/suites/$suiteId"
                    params={{ appId: suite.appMapId, suiteId: suite.id }}
                  >
                    <span className="relay-suite-icon" aria-hidden="true">
                      <Layers3 />
                    </span>
                    <span>
                      <strong>{suite.name}</strong>
                      <small>
                        {suite.appName} · {suite.tests.length}{" "}
                        {suite.tests.length === 1 ? "Test" : "Tests"}
                        {suite.variableIds.length
                          ? ` · ${suite.variableIds.length} Data ${suite.variableIds.length === 1 ? "set" : "sets"}`
                          : ""}
                      </small>
                    </span>
                    <OutcomeMark outcome={needsReview ? "needs-review" : "passed"} />
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
          title="No Suites yet"
          detail="Group related Tests into a reusable release, regression, or smoke plan."
          action={
            apps.data?.length ? (
              <Button variant="primary" onClick={() => setDialogOpen(true)}>
                New Suite
              </Button>
            ) : (
              <Link className="relay-inline-link" to="/apps">
                Add an App first
              </Link>
            )
          }
        />
      ) : null}
    </section>
  );
}
