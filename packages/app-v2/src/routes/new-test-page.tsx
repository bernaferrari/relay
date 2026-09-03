/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { recordingQueryKeys } from "../data/recording-queries";
import { readWorkflowPointer, writeWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

export function NewTestPage() {
  const { platform, productService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [appId, setAppId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");

  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
  });
  const targets = useQuery({
    queryKey: recordingQueryKeys.targets,
    queryFn: () => productService.connect(),
    staleTime: 5_000,
  });
  const activePointer = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: () => readWorkflowPointer(platform),
    staleTime: Infinity,
  });

  const begin = useMutation({
    mutationFn: async () => {
      const state = await productService.begin({ title: title.trim(), appMapId: appId, targetId });
      if (state.recovery) return state;
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (!workflowId) throw new TypeError("The server did not return a durable recording handle.");
      await writeWorkflowPointer(platform, workflowId);
      queryClient.setQueryData(recordingQueryKeys.pointer, workflowId);
      return state;
    },
    onSuccess: async (state) => {
      if (state.recovery) return;
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (!workflowId) return;
      await navigate({
        to: "/tests/$testId/record",
        params: { testId: workflowId },
      });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !appId || !targetId || begin.isPending) return;
    begin.mutate();
  }

  const loading = apps.isPending || targets.isPending;
  const noApps = apps.data?.length === 0;
  const noTargets = targets.data?.targets.length === 0;
  const formReady = Boolean(title.trim() && appId && targetId && !begin.isPending);

  return (
    <section className="relay-page relay-new-test-page">
      <header className="relay-page-header">
        <p className="relay-eyebrow">Tests</p>
        <h1>Record a Test</h1>
        <p className="relay-page-description">
          Name the journey, then choose where Relay should record it.
        </p>
      </header>

      {activePointer.data ? (
        <div className="relay-resume-recording">
          <div>
            <strong>A recording is already in progress</strong>
            <p>Resume it before starting another Test.</p>
          </div>
          <Button
            size="small"
            onClick={() =>
              void navigate({
                to: "/tests/$testId/record",
                params: { testId: activePointer.data! },
              })
            }
          >
            Resume
          </Button>
        </div>
      ) : null}

      {loading ? <PageLoading label="Finding apps and ready devices…" /> : null}
      <RecordingProblem
        error={apps.error ?? targets.error ?? begin.error}
        recovery={begin.data?.recovery ?? targets.data?.recovery}
        onRetry={() => {
          void apps.refetch();
          void targets.refetch();
        }}
        retrying={apps.isFetching || targets.isFetching}
      />

      {!loading && !apps.isError && !targets.isError && !activePointer.data ? (
        <form className="relay-recording-form" onSubmit={submit}>
          <div className="relay-form-field">
            <label htmlFor="test-name">Test name</label>
            <input
              id="test-name"
              className="relay-input"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="For example, Change the app language"
              maxLength={160}
              autoComplete="off"
              spellCheck
            />
            <p>Use the outcome a person should recognize.</p>
          </div>

          <fieldset className="relay-choice-group" disabled={noApps}>
            <legend>App</legend>
            {noApps ? (
              <div className="relay-choice-empty">
                <strong>No apps are available</strong>
                <p>Add an app before recording a Test.</p>
                <Link className="relay-inline-link" to="/apps">
                  Manage apps
                </Link>
              </div>
            ) : (
              apps.data?.map((app) => (
                <label className="relay-choice" key={app.id}>
                  <input
                    type="radio"
                    name="app"
                    value={app.id}
                    checked={appId === app.id}
                    onChange={() => setAppId(app.id)}
                  />
                  <span>
                    <strong>{app.name}</strong>
                    <small>{app.id}</small>
                  </span>
                </label>
              ))
            )}
          </fieldset>

          <fieldset className="relay-choice-group" disabled={noTargets}>
            <legend>Device or browser</legend>
            {noTargets ? (
              <div className="relay-choice-empty">
                <strong>Nothing is ready to record</strong>
                <p>Connect a device or start a managed browser, then try again.</p>
              </div>
            ) : (
              targets.data?.targets.map((target) => {
                const label = targetLabel(target);
                return (
                  <label className="relay-choice" key={`${target.kind}:${target.targetId}`}>
                    <input
                      type="radio"
                      name="target"
                      value={target.targetId}
                      checked={targetId === target.targetId}
                      onChange={() => setTargetId(target.targetId)}
                    />
                    <span>
                      <strong>{label.title}</strong>
                      <small>{label.detail}</small>
                    </span>
                  </label>
                );
              })
            )}
          </fieldset>

          <div className="relay-form-actions">
            <Button type="submit" variant="primary" disabled={!formReady}>
              {begin.isPending ? "Starting…" : "Begin recording"}
            </Button>
            <Link className="relay-text-link relay-form-cancel" to="/tests">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}
    </section>
  );
}
