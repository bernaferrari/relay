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
import { Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  Breadcrumbs,
  EmptyState,
  OutcomeMark,
  RecoveryState,
} from "../components/product-patterns";
import { PageLoading } from "./recording-shared";

const routeApi = getRouteApi("/apps/$appId/suites/$suiteId");

export function SuitePage() {
  const { suiteProfileService, queryClient } = useRouteContext({ from: "__root__" });
  const { appId, suiteId } = routeApi.useParams();
  const navigate = useNavigate();
  const [profileIds, setProfileIds] = useState<Set<string>>(() => new Set());
  const [editOpen, setEditOpen] = useState(false);
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
  useEffect(() => {
    if (!profileIds.size && environments.data?.[0]) {
      setProfileIds(new Set([environments.data[0].id]));
    }
  }, [environments.data, profileIds]);
  const selectedProfileIds = [...profileIds];
  const preview = useQuery({
    queryKey: ["suites", appId, suiteId, "preview", selectedProfileIds],
    queryFn: () =>
      suiteProfileService.previewSuite({
        appMapId: appId,
        suiteId,
        profileIds: selectedProfileIds,
      }),
    enabled: Boolean(suite.data && selectedProfileIds.length),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => {
      if (!suite.data) throw new TypeError("This Suite is unavailable.");
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
      if (!suite.data) throw new TypeError("This Suite is unavailable.");
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
    mutationFn: () =>
      suiteProfileService.startSuite({
        appMapId: appId,
        suiteId,
        profileIds: selectedProfileIds,
        executionMode: "pilot",
      }),
    onSuccess: ({ batchId }) => navigate({ to: "/batches/$batchId", params: { batchId } }),
  });
  const value = suite.data;
  const needsReview = value?.tests.some((test) => test.status === "needs-review") ?? false;

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
    <section className="relay-page max-w-5xl">
      <Breadcrumbs
        items={[{ label: "Suites", to: "/suites" }, { label: value?.name ?? "Suite" }]}
      />
      {suite.isPending || editor.isPending ? <PageLoading label="Loading Suite…" /> : null}
      {suite.error || editor.error ? (
        <RecoveryState
          layout="centered"
          title="This Suite is unavailable"
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
          title="Suite not found"
          detail="It may have been removed from this App."
          action={
            <Link className="relay-inline-link" to="/suites">
              Back to Suites
            </Link>
          }
        />
      ) : null}
      {value ? (
        <>
          <header className="relay-page-header flex items-start justify-between gap-8 max-lg:flex-col">
            <div className="min-w-0 max-w-3xl">
              <p className="relay-eyebrow">{value.appName} · Suite</p>
              <h1 className="text-balance">{value.name}</h1>
              <p className="relay-page-description max-w-2xl">
                Choose an environment and run a representative case.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" onClick={beginEdit}>
                Edit Suite
              </Button>
              <Button
                variant="default"
                onClick={() => start.mutate()}
                disabled={
                  !selectedProfileIds.length ||
                  !preview.data ||
                  Boolean(preview.data?.blockers.length) ||
                  preview.data?.execution?.capacity === "unavailable" ||
                  start.isPending
                }
              >
                <Play aria-hidden="true" />
                {start.isPending
                  ? "Starting…"
                  : selectedProfileIds.length > 1
                    ? "Run Across unavailable"
                    : "Start pilot"}
              </Button>
            </div>
          </header>

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
                <OutcomeMark outcome={needsReview ? "needs-review" : "passed"} />
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
            <section
              className="min-w-0 rounded-xl border border-border-weak-base bg-surface-raised-strong p-4"
              aria-labelledby="suite-tests-title"
            >
              <p className="relay-section-label">Coverage</p>
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
                      <OutcomeMark outcome={test.status === "ready" ? "passed" : "needs-review"} />
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
              <p className="relay-section-label">Environment</p>
              <h2
                id="suite-environment-title"
                className="mt-1 text-base font-semibold text-text-strong"
              >
                Where should Relay run?
              </h2>
              {environments.data?.length ? (
                <Field className="mt-3">
                  <FieldLabel>Environment</FieldLabel>
                  <p className="text-xs leading-5 text-text-weak">
                    Choose one to run a pilot, or select more to compare readiness.
                  </p>
                  <fieldset className="mt-3 grid min-w-0 gap-2 border-0 p-0">
                    <legend className="sr-only">Environments</legend>
                    {environments.data.map((profile) => (
                      <ChoiceLabel
                        key={profile.id}
                        className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {profile.name}
                          </span>
                          <span className="truncate text-xs leading-snug text-muted-foreground">
                            {profile.platform} · {profile.target.name}
                          </span>
                        </span>
                        <Checkbox
                          checked={profileIds.has(profile.id)}
                          onCheckedChange={(checked) =>
                            setProfileIds((current) => {
                              const next = new Set(current);
                              if (checked === true && next.size < 4) next.add(profile.id);
                              if (checked !== true) next.delete(profile.id);
                              return next;
                            })
                          }
                        />
                      </ChoiceLabel>
                    ))}
                  </fieldset>
                </Field>
              ) : environments.isPending ? (
                <PageLoading label="Loading Environments…" />
              ) : (
                <EmptyState
                  title="No Environment is ready"
                  detail="Add a managed browser Space or connect a supported target before running this Suite."
                  action={
                    <Link className="relay-inline-link" to="/environments">
                      Open Environments
                    </Link>
                  }
                />
              )}
              {preview.data ? (
                <div
                  className={`mt-4 grid gap-1 rounded-lg border p-3 text-xs ${
                    preview.data.blockers.length
                      ? "border-border-critical-base bg-surface-critical-weak"
                      : "border-border-success-base bg-surface-success-weak"
                  }`}
                  role="status"
                >
                  <strong className="font-semibold text-text-strong">
                    {preview.data.blockers.length
                      ? "Needs attention"
                      : `${preview.data.caseCount} ${
                          preview.data.caseCount === 1 ? "case" : "cases"
                        } ${
                          preview.data.execution?.capacity === "unavailable" ? "previewed" : "ready"
                        }`}
                  </strong>
                  <span className="text-text-weak">
                    {preview.data.checkCount} {preview.data.checkCount === 1 ? "check" : "checks"}
                    {preview.data.expectedScreenshots === undefined
                      ? ""
                      : ` · about ${preview.data.expectedScreenshots} screenshots`}
                  </span>
                  {preview.data.execution?.capacity === "unavailable" ? (
                    <small className="text-text-weak">
                      Select one environment to start a pilot.
                    </small>
                  ) : null}
                  {preview.data.blockers.slice(0, 1).map((blocker) => (
                    <small
                      className="leading-5 text-text-weak"
                      key={`${blocker.code}:${blocker.suiteCellId ?? "suite"}`}
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
                    : "Relay could not check this Suite."}
                </FieldError>
              ) : null}
              {start.error ? (
                <FieldError>
                  {start.error instanceof Error
                    ? start.error.message
                    : "Relay could not start this Suite."}
                </FieldError>
              ) : null}
            </section>
          </div>

          <section
            className="mt-8 flex items-center justify-between gap-5 border-t border-border-weak-base pt-5 max-sm:items-start"
            aria-labelledby="remove-suite-title"
          >
            <div>
              <h2 id="remove-suite-title" className="text-sm font-semibold text-text-strong">
                Remove Suite
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
                  This removes the Suite grouping. Its Tests and Reports remain available.
                </DialogDescription>
                {remove.error ? (
                  <FieldError>
                    {remove.error instanceof Error
                      ? remove.error.message
                      : "Relay could not remove this Suite."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    className="relay-suite-remove-confirm"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? "Removing…" : "Remove Suite"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent showCloseButton={false} className="relay-suite-dialog">
              <DialogTitle>Edit Suite</DialogTitle>
              <DialogDescription>
                Keep the scope deliberate. Removing a Test from this Suite does not delete it.
              </DialogDescription>
              <form onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="edit-suite-name">Suite name</FieldLabel>
                  <Input
                    id="edit-suite-name"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </Field>
                <div className="relay-suite-dialog-scopes">
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
                            {test.status === "ready" ? "Ready" : "Needs review"}
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
                      : "Relay could not save this Suite."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions">
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
    </section>
  );
}

function friendlySuiteIssue(message: string): string {
  if (/ERR_CONNECTION_REFUSED|connection refused/i.test(message)) {
    return "The selected environment could not reach the app. Check its URL or start the app, then try again.";
  }
  if (/runtime profile/i.test(message)) {
    return "This environment needs a runtime profile before it can run the Suite.";
  }
  return "This environment is not ready yet. Review its configuration and try again.";
}
