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
  const [profileId, setProfileId] = useState("");
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
    if (!profileId && environments.data?.[0]) setProfileId(environments.data[0].id);
  }, [environments.data, profileId]);
  const preview = useQuery({
    queryKey: ["suites", appId, suiteId, "preview", profileId],
    queryFn: () => suiteProfileService.previewSuite({ appMapId: appId, suiteId, profileId }),
    enabled: Boolean(suite.data && profileId),
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
        profileId,
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
    <section className="relay-page relay-suite-page">
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
              variant="secondary"
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
          <header className="relay-page-header relay-suite-detail-header">
            <div>
              <p className="relay-eyebrow">{value.appName} · Suite</p>
              <h1>{value.name}</h1>
              <p className="relay-page-description">
                Review scope and readiness, then start with one representative case.
              </p>
            </div>
            <div className="relay-suite-detail-actions">
              <Button variant="secondary" onClick={beginEdit}>
                Edit Suite
              </Button>
              <Button
                variant="primary"
                onClick={() => start.mutate()}
                disabled={!profileId || Boolean(preview.data?.blockers.length) || start.isPending}
              >
                <Play aria-hidden="true" /> {start.isPending ? "Starting…" : "Start pilot"}
              </Button>
            </div>
          </header>

          <dl className="relay-suite-facts" aria-label={`${value.name} scope`}>
            <div>
              <dt>Tests</dt>
              <dd>{value.tests.length}</dd>
            </div>
            <div>
              <dt>Data sets</dt>
              <dd>{value.variableIds.length}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <OutcomeMark outcome={needsReview ? "needs-review" : "passed"} />
              </dd>
            </div>
          </dl>

          <div className="relay-suite-workspace">
            <section className="relay-suite-card" aria-labelledby="suite-tests-title">
              <p className="relay-section-label">Coverage</p>
              <h2 id="suite-tests-title">Saved Tests</h2>
              <ul className="relay-suite-scope-list">
                {value.tests.map((test) => (
                  <li key={test.id}>
                    <Link to="/tests/$testId" params={{ testId: test.id }}>
                      <span>{test.name}</span>
                      <OutcomeMark outcome={test.status === "ready" ? "passed" : "needs-review"} />
                    </Link>
                  </li>
                ))}
              </ul>
              {value.variableIds.length ? (
                <p className="relay-suite-data-summary">
                  {value.variableIds.length} saved Data{" "}
                  {value.variableIds.length === 1 ? "set expands" : "sets expand"} this scope using{" "}
                  {value.strategy ?? "cartesian"} coverage.
                </p>
              ) : (
                <p className="relay-suite-data-summary">
                  Each Test runs once with its saved defaults.
                </p>
              )}
            </section>

            <section className="relay-suite-card" aria-labelledby="suite-environment-title">
              <p className="relay-section-label">Environment</p>
              <h2 id="suite-environment-title">Where should Relay run?</h2>
              {environments.data?.length ? (
                <Field>
                  <FieldLabel htmlFor="suite-environment">Environment</FieldLabel>
                  <select
                    id="suite-environment"
                    className="relay-native-select"
                    value={profileId}
                    onChange={(event) => setProfileId(event.currentTarget.value)}
                  >
                    {environments.data.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
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
              {preview.isFetching ? (
                <p className="relay-action-hint">Checking Suite readiness…</p>
              ) : null}
              {preview.data ? (
                <div
                  className={`relay-suite-preflight${preview.data.blockers.length ? " relay-suite-preflight--blocked" : ""}`}
                  role="status"
                >
                  <strong>
                    {preview.data.blockers.length
                      ? "Needs attention"
                      : `${preview.data.caseCount} ${preview.data.caseCount === 1 ? "case" : "cases"} ready`}
                  </strong>
                  <span>
                    {preview.data.checkCount} checks
                    {preview.data.expectedScreenshots === undefined
                      ? ""
                      : ` · about ${preview.data.expectedScreenshots} screenshots`}
                  </span>
                  {preview.data.blockers.map((blocker) => (
                    <small key={`${blocker.code}:${blocker.suiteCellId ?? "suite"}`}>
                      {blocker.message}
                    </small>
                  ))}
                  {preview.data.warnings.map((warning) => (
                    <small key={`${warning.code}:${warning.suiteCellId ?? "suite"}`}>
                      {warning.message}
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

          <section className="relay-suite-danger" aria-labelledby="remove-suite-title">
            <div>
              <h2 id="remove-suite-title">Remove Suite</h2>
              <p>Tests and their Reports stay in the App. Only this saved grouping is removed.</p>
            </div>
            <Dialog.Root open={removeOpen} onOpenChange={setRemoveOpen}>
              <Dialog.Trigger render={<Button variant="secondary" />}>
                <Trash2 aria-hidden="true" /> Remove
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop className="relay-dialog-backdrop" />
                <Dialog.Viewport className="relay-dialog-viewport">
                  <Dialog.Popup className="relay-overlay-popup relay-dialog-popup">
                    <Dialog.Title>Remove {value.name}?</Dialog.Title>
                    <Dialog.Description>
                      This removes the Suite grouping. Its Tests and Reports remain available.
                    </Dialog.Description>
                    {remove.error ? (
                      <FieldError>
                        {remove.error instanceof Error
                          ? remove.error.message
                          : "Relay could not remove this Suite."}
                      </FieldError>
                    ) : null}
                    <div className="relay-dialog-actions">
                      <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
                      <Button
                        className="relay-suite-remove-confirm"
                        onClick={() => remove.mutate()}
                        disabled={remove.isPending}
                      >
                        {remove.isPending ? "Removing…" : "Remove Suite"}
                      </Button>
                    </div>
                  </Dialog.Popup>
                </Dialog.Viewport>
              </Dialog.Portal>
            </Dialog.Root>
          </section>

          <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
            <Dialog.Portal>
              <Dialog.Backdrop className="relay-dialog-backdrop" />
              <Dialog.Viewport className="relay-dialog-viewport">
                <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-suite-dialog">
                  <Dialog.Title>Edit Suite</Dialog.Title>
                  <Dialog.Description>
                    Keep the scope deliberate. Removing a Test from this Suite does not delete it.
                  </Dialog.Description>
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
                      {editor.data?.dataSets.length ? (
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
                    {save.error ? (
                      <FieldError>
                        {save.error instanceof Error
                          ? save.error.message
                          : "Relay could not save this Suite."}
                      </FieldError>
                    ) : null}
                    <div className="relay-dialog-actions">
                      <Dialog.Close render={<Button variant="ghost">Cancel</Button>} />
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!name.trim() || !testIds.size || save.isPending}
                      >
                        {save.isPending ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      ) : null}
    </section>
  );
}
