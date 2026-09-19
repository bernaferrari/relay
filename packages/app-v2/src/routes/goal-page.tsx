/** @jsxImportSource react */
import { Alert, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Compass, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { GoalExplorationRecord, GoalFinding, GoalSessionRecord } from "@relay/protocol";
import type { AuthorTestSnapshot } from "@relay/workflows";
import type { GoalRunResult, GoalSessionInspect } from "../data/goal-product-service";
import { FormPage, PageHeader } from "../components/page-layout";

type GoalEvidence = GoalRunResult | GoalSessionRecord | GoalSessionInspect | GoalExplorationRecord;

function isSessionEvidence(
  result: GoalEvidence,
): result is Extract<GoalEvidence, { sessionId: string }> {
  return "sessionId" in result;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isExplorationEvidence(
  result: GoalEvidence,
): result is Extract<GoalEvidence, { workers: unknown }> {
  return "workers" in result;
}

function FindingCard({ finding }: { finding: GoalFinding }) {
  return (
    <article className="grid gap-1 rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">{finding.title}</p>
        <span className="shrink-0 text-xs text-muted-foreground capitalize">{finding.status}</span>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">{finding.summary}</p>
      <p className="text-xs text-muted-foreground">Review required · {finding.kind}</p>
    </article>
  );
}

function PromotionResult({ result }: { result: AuthorTestSnapshot }) {
  return (
    <Alert>
      <AlertTitle>Test promotion ready for review</AlertTitle>
      <AlertDescription>
        {result.title} is now in the existing Authoring flow at <strong>{result.stage}</strong>.
        Human review and approval remain required before it becomes a saved Test.
      </AlertDescription>
    </Alert>
  );
}

export function GoalPage() {
  const { goalService } = useRouteContext({ from: "__root__" });
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [agents, setAgents] = useState("1");
  const [maxSteps, setMaxSteps] = useState("12");
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("5");
  const [confirmControl, setConfirmControl] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [missionsText, setMissionsText] = useState("");
  const [valuesText, setValuesText] = useState("");
  const [promotionTitle, setPromotionTitle] = useState("");
  const [confirmPromotion, setConfirmPromotion] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const run = useMutation({ mutationFn: goalService.start });
  const inspect = useMutation<GoalSessionRecord | GoalExplorationRecord, Error, GoalRunResult>({
    mutationFn: (result: GoalRunResult) =>
      isSessionEvidence(result)
        ? goalService.inspectSession(result.sessionId)
        : goalService.inspectExploration(result.id),
  });
  const resume = useMutation<GoalRunResult, Error, GoalEvidence>({
    mutationFn: (result: GoalEvidence) =>
      isSessionEvidence(result)
        ? goalService.resumeSession(result.sessionId)
        : goalService.resumeExploration(result.id),
  });
  const reproduce = useMutation({ mutationFn: goalService.reproduceSession });
  const promote = useMutation({ mutationFn: goalService.promoteSession });
  const cancel = useMutation({ mutationFn: goalService.cancelSession });

  // Live activity: the server owns the job, so the UI can attach to it. Poll
  // while it runs and stop at any terminal status.
  const liveSource = reproduce.data ?? run.data;
  const liveSessionId =
    liveSource && isSessionEvidence(liveSource) ? liveSource.sessionId : undefined;
  const live = useQuery({
    queryKey: ["goal-session", liveSessionId],
    enabled: Boolean(liveSessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.status === "pending" ? 2_000 : false,
    queryFn: () => goalService.inspectSession(liveSessionId as string),
  });

  const agentCount = Number(agents);
  const maxStepsValue = Number(maxSteps);
  const maxDurationMinutesValue = Number(maxDurationMinutes);
  const validAgents = Number.isInteger(agentCount) && agentCount >= 1 && agentCount <= 4;
  const validBudget =
    Number.isInteger(maxStepsValue) &&
    maxStepsValue >= 1 &&
    maxStepsValue <= 40 &&
    Number.isInteger(maxDurationMinutesValue) &&
    maxDurationMinutesValue >= 1 &&
    maxDurationMinutesValue <= 15;
  const valid =
    goal.trim().length > 0 &&
    isHttpUrl(startUrl.trim()) &&
    validAgents &&
    validBudget &&
    confirmControl;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || run.isPending) return;
    inspect.reset();
    resume.reset();
    reproduce.reset();
    promote.reset();
    setConfirmResume(false);
    setPromotionTitle("");
    setConfirmPromotion(false);
    const missions = missionsText
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 4);
    const values: Record<string, string> = {};
    for (const line of valuesText.split("\n")) {
      const split = line.indexOf("=");
      const name = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      if (split > 0 && name && value) values[name] = value;
    }
    run.mutate({
      goal: goal.trim(),
      startUrl: startUrl.trim(),
      agents: Number.isInteger(agentCount) ? Math.min(4, Math.max(1, agentCount)) : 1,
      maxSteps: maxStepsValue,
      maxDurationMs: maxDurationMinutesValue * 60_000,
      ...(missions.length > 0 ? { missions } : {}),
      ...(Object.keys(values).length > 0 ? { values } : {}),
      confirmControl: true,
    });
  }

  function submitWithShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const displayedResult = resume.data ?? reproduce.data ?? live.data ?? inspect.data ?? run.data;
  const resultError =
    promote.error ?? reproduce.error ?? resume.error ?? inspect.error ?? run.error;
  const resultErrorTitle = promote.error
    ? "Test promotion failed"
    : reproduce.error
      ? "Fresh reproduction failed"
      : resume.error
        ? "Resume after review failed"
        : inspect.error
          ? "Evidence refresh failed"
          : "Goal exploration failed";
  const canResume =
    displayedResult &&
    isSessionEvidence(displayedResult) &&
    ("resumeRequiresReview" in displayedResult
      ? displayedResult.resumeRequiresReview === true
      : ("pendingAction" in displayedResult && displayedResult.pendingAction !== undefined) ||
        displayedResult.stopReason?.code === "action-uncertain" ||
        displayedResult.stopReason?.code === "resume-review-required");
  const canReproduce =
    displayedResult &&
    isSessionEvidence(displayedResult) &&
    displayedResult.status === "completed" &&
    !displayedResult.reproduction;
  const canPromote =
    displayedResult &&
    isSessionEvidence(displayedResult) &&
    displayedResult.reproduction?.status === "reproduced";
  // The workflow field exists only on server-owned inspect responses; narrow
  // once here instead of inside JSX.
  const workflowInfo =
    displayedResult && "workflow" in displayedResult && displayedResult.workflow
      ? (displayedResult.workflow as { status: string; version: number })
      : undefined;

  return (
    <FormPage>
      <PageHeader
        crumbs={[{ label: "Explore" }]}
        title="Start from a goal"
        description="Give Relay an app and an outcome. It works within a bounded budget using the model configured in Settings, retains the evidence, and leaves anything worth promoting for review."
      />

      <div className="grid max-w-5xl gap-6 min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
        <form
          onSubmit={submit}
          className="grid gap-5 rounded-xl border border-border/70 bg-background/40 p-5 shadow-sm"
        >
          <Field>
            <FieldLabel htmlFor="goal-description">What should Relay accomplish?</FieldLabel>
            <Textarea
              id="goal-description"
              value={goal}
              onChange={(event) => setGoal(event.currentTarget.value)}
              onKeyDown={submitWithShortcut}
              placeholder="Find the checkout button and verify that it opens the payment step"
              maxLength={2048}
              rows={4}
              required
              spellCheck={false}
            />
            <FieldDescription>
              Use an observable outcome. Relay fills fields only from named task values; credentials
              belong to an account fixture.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-start-url">App URL</FieldLabel>
            <Input
              id="goal-start-url"
              type="url"
              value={startUrl}
              onChange={(event) => setStartUrl(event.currentTarget.value)}
              placeholder="https://staging.example.com"
              autoComplete="url"
              aria-invalid={submitted && !isHttpUrl(startUrl.trim())}
              required
            />
            <FieldDescription>
              Each worker gets an isolated, signed-out browser target.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="goal-agents">Workers</FieldLabel>
            <Input
              id="goal-agents"
              type="number"
              min={1}
              max={4}
              step={1}
              value={agents}
              onChange={(event) => setAgents(event.currentTarget.value)}
              inputMode="numeric"
            />
            <FieldDescription>
              Use one worker for a focused run; up to four isolated workers are supported.
            </FieldDescription>
          </Field>
          <details className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer py-1 text-sm font-medium text-foreground">
              Advanced budget
            </summary>
            <div className="grid gap-4 pt-3">
              <Field>
                <FieldLabel htmlFor="goal-max-steps">Maximum steps</FieldLabel>
                <Input
                  id="goal-max-steps"
                  type="number"
                  min={1}
                  max={40}
                  step={1}
                  value={maxSteps}
                  onChange={(event) => setMaxSteps(event.currentTarget.value)}
                  inputMode="numeric"
                />
                <FieldDescription>At most 40 actions; the default is 12.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-max-duration">Time budget (minutes)</FieldLabel>
                <Input
                  id="goal-max-duration"
                  type="number"
                  min={1}
                  max={15}
                  step={1}
                  value={maxDurationMinutes}
                  onChange={(event) => setMaxDurationMinutes(event.currentTarget.value)}
                  inputMode="numeric"
                />
                <FieldDescription>At most 15 minutes; the default is 5.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-missions">
                  Distinct missions (optional, one per line)
                </FieldLabel>
                <Textarea
                  id="goal-missions"
                  value={missionsText}
                  onChange={(event) => setMissionsText(event.currentTarget.value)}
                  placeholder={"Member permissions\nSigned-out recovery"}
                  rows={3}
                  maxLength={8_400}
                />
                <FieldDescription>
                  With multiple workers, each line drives exactly one worker. Four copies of one
                  goal buy no new coverage.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="goal-values">
                  Task values (optional, name=value per line)
                </FieldLabel>
                <Textarea
                  id="goal-values"
                  value={valuesText}
                  onChange={(event) => setValuesText(event.currentTarget.value)}
                  placeholder="username=member@example.test"
                  rows={2}
                  maxLength={8_400}
                />
                <FieldDescription>
                  Plain form inputs only — the model sees reference names, never values. Credentials
                  belong to an account fixture.
                </FieldDescription>
              </Field>
            </div>
          </details>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 text-sm leading-5 hover:bg-muted/40">
            <Checkbox
              checked={confirmControl}
              onCheckedChange={(checked) => setConfirmControl(checked === true)}
              aria-label="Confirm target control"
            />
            <span>
              I confirm Relay may open this URL and interact with its isolated browser target within
              the bounded budget.
            </span>
          </label>
          {submitted && !valid ? (
            <FieldError>
              Enter a goal and valid URL, choose a bounded budget, then confirm target control.
            </FieldError>
          ) : null}
          {run.error ? (
            <FieldError>
              {run.error instanceof Error ? run.error.message : "The goal could not start."}
            </FieldError>
          ) : null}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-muted-foreground">Cmd/Ctrl + Enter submits</span>
            <Button type="submit" disabled={run.isPending || !valid}>
              <Compass aria-hidden="true" />
              {run.isPending ? "Exploring…" : "Explore goal"}
            </Button>
          </div>
        </form>

        <section className="grid content-start gap-4" aria-label="Goal evidence">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Retained evidence
            </p>
            {!displayedResult ? (
              <p className="mt-3 max-w-prose text-sm leading-5 text-muted-foreground">
                Start an exploration to see its status, worker count, and review-required findings
                here.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 text-sm">
                <dl className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="font-medium capitalize">{displayedResult.status}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Evidence ID</dt>
                    <dd className="max-w-60 truncate font-mono text-xs">
                      {isSessionEvidence(displayedResult)
                        ? displayedResult.sessionId
                        : displayedResult.id}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-muted-foreground">Findings</dt>
                    <dd>{displayedResult.findings?.length ?? 0} review-required</dd>
                  </div>
                  {isSessionEvidence(displayedResult) ? (
                    <>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-muted-foreground">Execution</dt>
                        <dd className="font-medium capitalize">
                          {displayedResult.actions.length} action
                          {displayedResult.actions.length === 1 ? "" : "s"} ·{" "}
                          {displayedResult.status}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-muted-foreground">Captures</dt>
                        <dd>
                          {
                            displayedResult.actions.filter(
                              (action) => action.interaction.kind === "capture",
                            ).length
                          }{" "}
                          captured · awaiting review
                        </dd>
                      </div>
                      {workflowInfo ? (
                        <div className="flex items-baseline justify-between gap-4">
                          <dt className="text-muted-foreground">Workflow</dt>
                          <dd className="font-mono text-xs">
                            {workflowInfo.status} · v{workflowInfo.version}
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </dl>
                {isSessionEvidence(displayedResult) && displayedResult.status === "running" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(displayedResult.sessionId)}
                  >
                    {cancel.isPending ? "Cancelling…" : "Cancel this goal"}
                  </Button>
                ) : null}
                {displayedResult.stopReason ? (
                  <p className="rounded-lg bg-background/70 p-3 text-sm leading-5 text-muted-foreground">
                    {displayedResult.stopReason.message}
                  </p>
                ) : null}
                {isExplorationEvidence(displayedResult) ? (
                  <div className="grid gap-2" aria-label="Goal workers">
                    <p className="font-medium text-foreground">Workers</p>
                    {displayedResult.workers.map((worker) => (
                      <div
                        key={worker.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 p-3"
                      >
                        <span>Worker {worker.index}</span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {worker.status}
                          {worker.result?.findings?.length
                            ? ` · ${worker.result.findings.length} finding${worker.result.findings.length === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {displayedResult.findings?.length ? (
                  <div className="grid gap-2" aria-label="Review findings">
                    <p className="font-medium text-foreground">Review findings</p>
                    {displayedResult.findings.map((finding) => (
                      <FindingCard key={finding.id} finding={finding} />
                    ))}
                  </div>
                ) : null}
                {canResume ? (
                  <div className="grid gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
                    <div>
                      <p className="font-medium text-foreground">Review before resuming</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        An earlier interaction may have applied. Confirm that you reviewed the
                        current target; Relay will observe it again and will not replay that action.
                      </p>
                    </div>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5">
                      <Checkbox
                        checked={confirmResume}
                        onCheckedChange={(checked) => setConfirmResume(checked === true)}
                        aria-label="Confirm reviewed target resume"
                      />
                      <span>I confirm the current target is safe to observe again.</span>
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!confirmResume || resume.isPending}
                      onClick={() => resume.mutate(displayedResult)}
                    >
                      <RotateCcw aria-hidden="true" />
                      {resume.isPending ? "Resuming…" : "Resume after review"}
                    </Button>
                  </div>
                ) : null}
                {canReproduce ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={reproduce.isPending}
                    onClick={() => {
                      if (isSessionEvidence(displayedResult)) {
                        reproduce.mutate(displayedResult.sessionId);
                      }
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    {reproduce.isPending ? "Reproducing…" : "Replay on a fresh target"}
                  </Button>
                ) : null}
                {canPromote ? (
                  <div className="grid gap-3 rounded-lg border border-border/60 bg-background/50 p-3">
                    <div>
                      <p className="font-medium text-foreground">Save as a Test</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Fresh reproduction succeeded. Promotion records the path, then leaves human
                        review and approval in control.
                      </p>
                    </div>
                    <Field>
                      <FieldLabel htmlFor="goal-promotion-title">Test title (optional)</FieldLabel>
                      <Input
                        id="goal-promotion-title"
                        value={promotionTitle}
                        onChange={(event) => setPromotionTitle(event.currentTarget.value)}
                        placeholder="Goal reproduction: checkout"
                        maxLength={160}
                      />
                    </Field>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5">
                      <Checkbox
                        checked={confirmPromotion}
                        onCheckedChange={(checked) => setConfirmPromotion(checked === true)}
                        aria-label="Confirm Test promotion"
                      />
                      <span>I confirm Relay may control the fresh target to record this Test.</span>
                    </label>
                    <Button
                      type="button"
                      disabled={!confirmPromotion || promote.isPending}
                      onClick={() => {
                        if (isSessionEvidence(displayedResult)) {
                          promote.mutate({
                            sessionId: displayedResult.sessionId,
                            ...(promotionTitle.trim() ? { title: promotionTitle.trim() } : {}),
                            confirmControl: true,
                          });
                        }
                      }}
                    >
                      <Save aria-hidden="true" />
                      {promote.isPending ? "Saving…" : "Save as Test"}
                    </Button>
                  </div>
                ) : null}
                {promote.data ? <PromotionResult result={promote.data} /> : null}
                {resultError ? (
                  <Alert variant="destructive">
                    <AlertTitle>{resultErrorTitle}</AlertTitle>
                    <AlertDescription>{resultError.message}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={inspect.isPending}
                  onClick={() => {
                    const source = resume.data ?? reproduce.data ?? run.data;
                    if (source) inspect.mutate(source);
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {inspect.isPending ? "Refreshing…" : "Refresh evidence"}
                </Button>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border/50 bg-background/30 p-4 text-sm leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">Safe boundary</p>
            <p className="mt-1">
              A model suggestion is evidence, not proof. Fresh reproduction and promotion remain
              explicit review steps. The configured model and its data handling are recorded with
              the result — see Settings to review them.
            </p>
          </div>
        </section>
      </div>
    </FormPage>
  );
}
