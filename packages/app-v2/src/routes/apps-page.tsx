/** @jsxImportSource react */
import { Button, Dialog, Field, FieldError, FieldLabel, Input } from "@relay/ui-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Boxes, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { recordingQueryKeys } from "../data/recording-queries";
import { PageLoading } from "./recording-shared";

export function AppsPage() {
  const { productService, catalogService, appResourcesService } = useRouteContext({
    from: "__root__",
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
    staleTime: 15_000,
  });
  const tests = useQuery({
    queryKey: ["catalog", "tests"],
    queryFn: () => catalogService.listTests(),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: ["catalog", "runs", { view: "all" }],
    queryFn: () => catalogService.listRuns({ view: "all" }),
    staleTime: 10_000,
  });
  const createApp = useMutation({
    mutationFn: (appName: string) => appResourcesService.createApp(appName),
    onSuccess: async (app) => {
      await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.apps });
      setDialogOpen(false);
      setName("");
      await navigate({ to: "/apps/$appId", params: { appId: app.id } });
    },
  });
  const loading = apps.isPending || tests.isPending || runs.isPending;
  const error = apps.error ?? tests.error ?? runs.error;
  const retry = () => {
    void apps.refetch();
    void tests.refetch();
    void runs.refetch();
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) createApp.mutate(name);
  }

  return (
    <section className="relay-page relay-apps-page">
      <header className="relay-page-header relay-apps-header">
        <div>
          <p className="relay-eyebrow">Workspace</p>
          <h1>Apps</h1>
          <p className="relay-page-description">
            Keep each app’s Tests, Reports, and known behavior together.
          </p>
        </div>
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger render={<Button variant="primary" />}>
            <Plus aria-hidden="true" /> Add App
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="relay-dialog-backdrop" />
            <Dialog.Viewport className="relay-dialog-viewport">
              <Dialog.Popup className="relay-overlay-popup relay-dialog-popup relay-add-app-dialog">
                <Dialog.Title>Add an App</Dialog.Title>
                <Dialog.Description>
                  Give the app a clear name. Relay will create its empty App Map and open the app
                  workspace.
                </Dialog.Description>
                <form onSubmit={submit}>
                  <Field>
                    <FieldLabel htmlFor="new-app-name">App name</FieldLabel>
                    <Input
                      id="new-app-name"
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                      placeholder="For example, Checkout"
                      autoComplete="off"
                      autoFocus
                    />
                    {createApp.error ? (
                      <FieldError>
                        {createApp.error instanceof Error
                          ? createApp.error.message
                          : "Relay could not add this app."}
                      </FieldError>
                    ) : null}
                  </Field>
                  <div className="relay-dialog-actions">
                    <Dialog.Close
                      className="relay-button relay-button--ghost relay-button--medium"
                      disabled={createApp.isPending}
                    >
                      Cancel
                    </Dialog.Close>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!name.trim() || createApp.isPending}
                    >
                      {createApp.isPending ? "Adding…" : "Add App"}
                    </Button>
                  </div>
                </form>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      {loading ? <PageLoading label="Loading apps…" /> : null}
      {error ? (
        <RecoveryState
          className="relay-apps-recovery"
          layout="centered"
          title="Relay is not connected"
          detail="Start Relay, then try loading your apps again."
          action={
            <Button
              variant="secondary"
              onClick={retry}
              disabled={apps.isFetching || tests.isFetching || runs.isFetching}
            >
              <RotateCcw aria-hidden="true" />
              {apps.isFetching || tests.isFetching || runs.isFetching
                ? "Trying again…"
                : "Try again"}
            </Button>
          }
        />
      ) : null}
      {!loading && !error && apps.data?.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No apps yet"
          detail="Add the first app you want Relay to map, test, and verify."
          action={
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Add App
            </Button>
          }
        />
      ) : null}
      {!error && apps.data?.length ? (
        <ul className="relay-app-grid" aria-label="Apps">
          {apps.data.map((app) => {
            const testCount = tests.data?.filter((test) => test.appMapId === app.id).length ?? 0;
            const appRuns = runs.data?.filter((run) => run.appMapId === app.id) ?? [];
            const latest = [...appRuns].sort((left, right) => runTime(right) - runTime(left))[0];
            return (
              <li key={app.id}>
                <Link to="/apps/$appId" params={{ appId: app.id }}>
                  <span className="relay-app-grid-icon" aria-hidden="true">
                    {app.name.slice(0, 1).toLocaleUpperCase()}
                  </span>
                  <span className="relay-app-grid-copy">
                    <strong>{app.name}</strong>
                    <small>
                      {testCount} {testCount === 1 ? "Test" : "Tests"}
                      {latest ? ` · Last run ${relativeTime(runTime(latest))}` : " · No runs yet"}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function runTime(run: { finishedAt?: number; startedAt?: number; queuedAt: number }): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
