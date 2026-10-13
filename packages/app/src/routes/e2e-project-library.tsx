/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldLabel, FieldError } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { FileCode, FolderOpen, Play, RefreshCw, Square } from "lucide-react";
import type { E2EExecution } from "@relay/protocol";
import { createE2EProjectService } from "../data/e2e-project-service";

const key = ["e2e-projects"] as const;
export function E2EProjectLibrary({
  open,
  onOpenChange,
  search,
  onCount,
  visible = true,
  initialProjectId,
  onProjectClose,
}: {
  open: boolean;
  onOpenChange(value: boolean): void;
  search: string;
  onCount(count: number): void;
  visible?: boolean;
  initialProjectId?: string;
  onProjectClose(): void;
}) {
  const { platform, queryClient } = useRouteContext({ from: "__root__" });
  const service = useMemo(() => createE2EProjectService(platform), [platform]);
  const [path, setPath] = useState("");
  const [selected, setSelected] = useState<string | undefined>(initialProjectId);
  const [source, setSource] = useState<{ file: string; text: string }>();
  const [executionId, setExecutionId] = useState<string>();
  const projects = useQuery({
    queryKey: key,
    queryFn: service.list,
    staleTime: 15000,
    retry: false,
  });
  const current = projects.data?.projects.find((p) => p.id === selected);
  const refreshLibrary = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: () => service.open(path.trim()),
    retry: false,
    onSuccess: async ({ project }) => {
      await refreshLibrary();
      setSelected(project.id);
      onOpenChange(false);
      setPath("");
    },
  });
  const refresh = useMutation({
    mutationFn: () => service.refresh(current!.id),
    retry: false,
    onSuccess: refreshLibrary,
  });
  const run = useMutation({
    mutationFn: (testId?: string) => service.run(current!.id, testId),
    retry: false,
    onSuccess: ({ execution }) => {
      setExecutionId(execution.id);
      void refreshLibrary();
    },
  });
  const readSource = useMutation({
    mutationFn: (file: string) => service.source(current!.id, file),
    retry: false,
    onSuccess: setSource,
  });
  const active = useQuery({
    queryKey: [...key, "execution", executionId],
    queryFn: () => service.execution(executionId!),
    enabled: Boolean(executionId),
    refetchInterval: (q) =>
      ["running", "importing"].includes(q.state.data?.execution.status ?? "") ? 750 : false,
    retry: false,
  });
  const stop = useMutation({
    mutationFn: () => service.cancel(executionId!),
    retry: false,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...key, "execution", executionId] }),
  });
  const retry = useMutation({
    mutationFn: () => service.retryImport(executionId!),
    retry: false,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...key, "execution", executionId] });
      await refreshLibrary();
      await queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
  useEffect(() => {
    onCount(
      (projects.data?.projects ?? []).reduce(
        (n, p) => n + new Set(p.tests.map((t) => JSON.stringify([t.file, t.titlePath]))).size,
        0,
      ),
    );
  }, [projects.data, onCount]);
  useEffect(() => {
    if (
      active.data?.execution.status === "complete" ||
      active.data?.execution.status === "import-incomplete"
    ) {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
      void queryClient.invalidateQueries({ queryKey: ["review"] });
      void refreshLibrary();
    }
  }, [active.data?.execution.status, queryClient]);
  const error =
    add.error ||
    refresh.error ||
    run.error ||
    readSource.error ||
    stop.error ||
    retry.error ||
    active.error;
  const running = active.data?.execution;
  const saved = projects.data?.executions.filter((e) => e.projectId === selected) ?? [];
  const matches = (projects.data?.projects ?? []).filter(
    (p) =>
      !search ||
      [p.name, ...p.tests.map((t) => t.title)].some((text) =>
        text.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!add.isPending) onOpenChange(value);
        }}
      >
        <DialogContent>
          <DialogTitle>Open an e2e project</DialogTitle>
          <DialogDescription>
            Use the project’s installed e2e 0.20.0 and existing configuration. Configuration and
            Tests run as local code; open a project you trust. This pilot supports web engines.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (path.trim() && !add.isPending) add.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="e2e-project-folder">Project folder</FieldLabel>
              <Input
                id="e2e-project-folder"
                value={path}
                onChange={(event) => setPath(event.currentTarget.value)}
                placeholder="/absolute/path/to/project"
                disabled={add.isPending}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {add.error ? <FieldError>{add.error.message}</FieldError> : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={add.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!path.trim() || add.isPending}>
                {add.isPending ? "Discovering Tests…" : "Trust project and open"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {visible && matches.length ? (
        <section className="mt-6" aria-label="e2e projects">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Code projects</h2>
          <ul className="divide-y rounded-xl border">
            {matches.map((project) => (
              <li key={project.id}>
                <button
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setSelected(project.id);
                    setExecutionId(undefined);
                    run.reset();
                    refresh.reset();
                    readSource.reset();
                    stop.reset();
                    retry.reset();
                  }}
                >
                  <FolderOpen className="size-4 text-muted-foreground" />
                  <span className="grid min-w-0 gap-1">
                    <span className="font-medium">{project.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      e2e ·{" "}
                      {
                        new Set(
                          project.tests.map((test) => JSON.stringify([test.file, test.titlePath])),
                        ).size
                      }{" "}
                      Tests · {new Set(project.tests.map((test) => test.target)).size} targets
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Dialog
        open={Boolean(current)}
        onOpenChange={(value) => {
          if (!value) {
            setSelected(undefined);
            onProjectClose();
          }
        }}
      >
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-3xl">
          <DialogTitle>{current?.name ?? "e2e project"}</DialogTitle>
          <DialogDescription>
            e2e 0.20.0 · {current?.configFile}. Edit the source files to change these Tests.
          </DialogDescription>
          {current ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {current.tests.length} configured Test cases
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={refresh.isPending || run.isPending || running?.status === "running"}
                    onClick={() => refresh.mutate()}
                  >
                    <RefreshCw className="size-4" />
                    Refresh Tests
                  </Button>
                  <Button
                    disabled={
                      run.isPending || ["running", "importing"].includes(running?.status ?? "")
                    }
                    onClick={() => run.mutate(undefined)}
                  >
                    <Play className="size-4" />
                    Run project
                  </Button>
                </div>
              </div>
              {error ? <FieldError>{error.message}</FieldError> : null}
              <ul className="divide-y rounded-xl border">
                {current.tests.map((test) => (
                  <li
                    key={test.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="font-medium">{test.title}</span>
                      <span className="break-all text-xs text-muted-foreground">
                        {test.file} · {test.target} · {test.agent}
                        {test.disposition === "skip" ? " · Skipped" : ""}
                      </span>
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={readSource.isPending}
                        onClick={() => readSource.mutate(test.file)}
                      >
                        <FileCode className="size-4" />
                        Source
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          test.disposition !== "run" ||
                          run.isPending ||
                          ["running", "importing"].includes(running?.status ?? "")
                        }
                        onClick={() => run.mutate(test.id)}
                      >
                        <Play className="size-4" />
                        Run
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {running ? (
                <Execution
                  execution={running}
                  onStop={() => stop.mutate()}
                  onRetry={() => retry.mutate()}
                  pending={stop.isPending || retry.isPending}
                />
              ) : null}
              {!running && saved.length ? (
                <div>
                  <h3 className="mb-2 text-sm font-medium">Recent executions</h3>
                  <ul className="grid gap-2">
                    {saved.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <Button variant="ghost" onClick={() => setExecutionId(e.id)}>
                          {new Date(e.startedAt).toLocaleString()} · {e.upstreamStatus ?? e.status}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(source)}
        onOpenChange={(value) => {
          if (!value) setSource(undefined);
        }}
      >
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-3xl">
          <DialogTitle>{source?.file}</DialogTitle>
          <DialogDescription>
            Code-managed Test. Edit this file in your project, then refresh Tests in Relay.
          </DialogDescription>
          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
            <code>{source?.text}</code>
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Execution({
  execution,
  onStop,
  onRetry,
  pending,
}: {
  execution: E2EExecution;
  onStop(): void;
  onRetry(): void;
  pending: boolean;
}) {
  const labels = {
    running: "Running with e2e…",
    importing: "Importing evidence…",
    complete: "Evidence imported",
    interrupted: "Execution needs attention",
    "import-incomplete": "Evidence incomplete",
  };
  return (
    <section className="grid gap-3 rounded-xl border p-4" aria-label="e2e execution">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{labels[execution.status]}</h3>
        {execution.status === "running" ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={onStop}>
            <Square className="size-4" />
            Stop
          </Button>
        ) : null}
      </div>
      {execution.upstreamStatus ? (
        <p className="text-sm">
          Upstream: {execution.upstreamStatus}
          {execution.exitCode !== undefined ? ` · exit ${execution.exitCode}` : ""}
        </p>
      ) : null}
      {execution.availableCaptures !== undefined ? (
        <p className="text-sm text-muted-foreground">
          {execution.requiredCaptures === undefined
            ? `${execution.availableCaptures} captures produced`
            : `${execution.availableCaptures} of ${execution.requiredCaptures} required captures available`}{" "}
          · {execution.pendingReview ?? 0} pending review · {execution.accepted ?? 0} accepted ·{" "}
          {execution.issues ?? 0} issues
        </p>
      ) : null}
      {execution.error ? <p className="text-sm text-destructive">{execution.error}</p> : null}
      {["import-incomplete", "interrupted"].includes(execution.status) ? (
        <Button variant="outline" disabled={pending} onClick={onRetry}>
          {pending ? "Importing…" : "Retry evidence import"}
        </Button>
      ) : null}
      {execution.runIds.length ? (
        <div className="flex flex-wrap gap-2">
          {execution.runIds.map((runId, index) => (
            <Button
              key={runId}
              variant="outline"
              nativeButton={false}
              render={<Link to="/runs/$runId" params={{ runId }} />}
            >
              {execution.results?.find((result) => result.runId === runId)?.title ??
                `Open result ${index + 1}`}
            </Button>
          ))}
        </div>
      ) : null}
      {execution.logs ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Execution output
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
            {execution.logs}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
