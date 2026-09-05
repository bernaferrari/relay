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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Boxes, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { recordingQueryKeys } from "../data/recording-queries";
import { PageLoading } from "./recording-shared";
import { LibraryPage, PageHeader } from "../components/page-layout";

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
      await navigate({ to: "/tests/new", search: { app: app.id } });
    },
  });
  const loading = apps.isPending;
  const error = apps.error;
  const secondaryError = tests.error ?? runs.error;
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
    <LibraryPage className="relay-apps-page">
      <PageHeader
        context="Workspace"
        title="Apps"
        description="Keep each app’s Tests, Reports, and known behavior together."
      >
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button variant="default" />}>
            <Plus aria-hidden="true" /> Add App
          </DialogTrigger>

          <DialogContent showCloseButton={false} className="relay-add-app-dialog">
            <DialogTitle>Add an App</DialogTitle>
            <DialogDescription>
              Give the app a clear name. Relay will create its App Map, then take you directly to
              target selection so you can record the first Test.
            </DialogDescription>
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
                <DialogClose
                  render={
                    <Button variant="ghost" disabled={createApp.isPending}>
                      Cancel
                    </Button>
                  }
                />
                <Button
                  type="submit"
                  variant="default"
                  disabled={!name.trim() || createApp.isPending}
                >
                  {createApp.isPending ? "Adding…" : "Add App"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {loading ? <PageLoading label="Loading apps…" /> : null}
      {error ? (
        <RecoveryState
          className="relay-apps-recovery"
          layout="centered"
          title="Relay is not connected"
          detail="Start Relay, then try loading your apps again."
          action={
            <Button
              variant="outline"
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
      {!loading && !error && secondaryError ? (
        <RecoveryState
          className="relay-apps-recovery"
          title="Some App activity is unavailable"
          detail="The App list is available. Test and Run counts will return when Relay reconnects."
          action={
            <Button
              variant="outline"
              onClick={retry}
              disabled={tests.isFetching || runs.isFetching}
            >
              <RotateCcw aria-hidden="true" />
              {tests.isFetching || runs.isFetching ? "Trying again…" : "Retry activity"}
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
            <Button variant="default" onClick={() => setDialogOpen(true)}>
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
                      {tests.isPending
                        ? "Loading Test count…"
                        : tests.error
                          ? "Test count unavailable"
                          : `${testCount} ${testCount === 1 ? "Test" : "Tests"}`}
                      {runs.isPending
                        ? " · Loading Run history…"
                        : runs.error
                          ? " · Run history unavailable"
                          : latest
                            ? ` · Last run ${relativeTime(runTime(latest))}`
                            : " · No runs yet"}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </LibraryPage>
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
