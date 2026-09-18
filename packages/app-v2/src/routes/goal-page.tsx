/** @jsxImportSource react */
import { Alert, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Compass, ExternalLink, RefreshCw } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { GoalExplorationRecord, GoalSessionRecord } from "@relay/protocol";
import type { GoalRunResult } from "../data/goal-product-service";
import { FormPage, PageHeader } from "../components/page-layout";

type GoalEvidence = GoalRunResult | GoalSessionRecord | GoalExplorationRecord;

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

export function GoalPage() {
  const { goalService } = useRouteContext({ from: "__root__" });
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [agents, setAgents] = useState("1");
  const [confirmControl, setConfirmControl] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const run = useMutation({ mutationFn: goalService.start });
  const inspect = useMutation<GoalSessionRecord | GoalExplorationRecord, Error, GoalRunResult>({
    mutationFn: (result: GoalRunResult) =>
      isSessionEvidence(result)
        ? goalService.inspectSession(result.sessionId)
        : goalService.inspectExploration(result.id),
  });

  const agentCount = Number(agents);
  const valid = goal.trim().length > 0 && isHttpUrl(startUrl.trim()) && confirmControl;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || run.isPending) return;
    run.mutate({
      goal: goal.trim(),
      startUrl: startUrl.trim(),
      agents: Number.isInteger(agentCount) ? Math.min(4, Math.max(1, agentCount)) : 1,
      confirmControl: true,
    });
  }

  function submitWithShortcut(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const displayedResult = inspect.data ?? run.data;

  return (
    <FormPage>
      <PageHeader
        crumbs={[{ label: "Explore" }]}
        title="Start from a goal"
        description="Give Relay an app and an outcome. It will use bounded OpenRouter decisions, retain the evidence, and leave anything worth promoting for review."
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
              Use an observable outcome. Relay will not invent credentials or type into fields.
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
            <FieldError>Enter a goal and a valid app URL, then confirm target control.</FieldError>
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
                </dl>
                {displayedResult.stopReason ? (
                  <p className="rounded-lg bg-background/70 p-3 text-sm leading-5 text-muted-foreground">
                    {displayedResult.stopReason.message}
                  </p>
                ) : null}
                {run.error || inspect.error ? (
                  <Alert variant="destructive">
                    <AlertTitle>Evidence refresh failed</AlertTitle>
                    <AlertDescription>{(inspect.error ?? run.error)?.message}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={inspect.isPending}
                  onClick={() => {
                    if (run.data) inspect.mutate(run.data);
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
              explicit review steps.
            </p>
            <a
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              href="https://openrouter.ai/typesafe"
              target="_blank"
              rel="noreferrer"
            >
              OpenRouter Jev details <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </section>
      </div>
    </FormPage>
  );
}
