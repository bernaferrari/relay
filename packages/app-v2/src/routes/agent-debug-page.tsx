/** @jsxImportSource react */
import { Field, FieldDescription, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@relay/ui-react/components/select";
import type { DebugBugOutcome } from "@relay/product/agent-debug";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import { deviceQueryKeys } from "../data/device-product-service";
import { runQueryKeys } from "../data/run-queries";

function isStartOutcome(
  value: DebugBugOutcome | undefined,
): value is Extract<DebugBugOutcome, { action: "start" }> {
  return value?.action === "start";
}

export function AgentDebugPage() {
  const { agentDebugService, deviceService, runService } = useRouteContext({ from: "__root__" });
  const location = useLocation();
  const navigate = useNavigate();
  const contextualTargetId =
    typeof (location.search as { target?: unknown }).target === "string"
      ? (location.search as { target: string }).target
      : undefined;
  const contextualRunId =
    typeof (location.search as { runId?: unknown }).runId === "string"
      ? (location.search as { runId: string }).runId
      : undefined;
  const [title, setTitle] = useState("");
  const [targetId, setTargetId] = useState(contextualTargetId ?? "");
  const report = useQuery({
    queryKey: runQueryKeys.report(contextualRunId ?? "unselected"),
    queryFn: () => runService.getReport(contextualRunId!),
    enabled: Boolean(contextualRunId),
    retry: false,
  });
  const failureStep = useMemo(
    () => report.data?.timeline.find((step) => step.state === "failed"),
    [report.data?.timeline],
  );
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
  });
  const readyDevices = (devices.data ?? []).filter((device) => device.runnable);
  const targetReady = readyDevices.some((device) => device.serial === targetId);
  useEffect(() => {
    if (!targetId && contextualTargetId) setTargetId(contextualTargetId);
  }, [contextualTargetId, targetId]);
  useEffect(() => {
    if (!report.data || title) return;
    setTitle(`Investigate ${report.data.title}`);
  }, [report.data, title]);
  useEffect(() => {
    if (!report.data?.targetName || targetId) return;
    const matchingTargets = readyDevices.filter((device) => device.name === report.data.targetName);
    if (matchingTargets.length === 1) setTargetId(matchingTargets[0]!.serial);
  }, [readyDevices, report.data?.targetName, targetId]);
  const start = useMutation({
    mutationFn: (input: Parameters<AgentDebugProductService["debugBug"]>[0]) =>
      agentDebugService.debugBug(input),
    onSuccess: async (outcome) => {
      if (isStartOutcome(outcome) && outcome.recording.authoring?.sessionId) {
        await navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: outcome.recording.authoring.sessionId },
        });
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !targetReady) return;
    const origin =
      contextualRunId && report.data && failureStep
        ? {
            schemaVersion: 1 as const,
            source: {
              runId: contextualRunId,
              attempt: failureStep.attempt ?? 1,
              stepId: failureStep.id,
            },
            evidenceRefs: report.data.evidence
              .flatMap((section) => section.items.map((item) => item.id))
              .slice(0, 64),
            configRefs: Object.entries(report.data.executionContext ?? {})
              .filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string" && entry[1].length > 0,
              )
              .map(([key, value]) => `${key}:${value}`)
              .slice(0, 64),
          }
        : undefined;
    start.mutate({
      kind: "debug-bug",
      action: "start",
      title: title.trim(),
      targetId,
      confirmControl: true,
      ...(origin ? { debugOrigin: origin } : {}),
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
      <header className="max-w-2xl space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-weak">Agent Debug</p>
        <h1 className="text-3xl font-semibold tracking-tight text-text-strong text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
          Investigate a bug
        </h1>
        <p className="max-w-prose text-base leading-7 text-text-weak">
          Capture a reproducible path and review the evidence with your team.
        </p>
      </header>

      {contextualRunId ? (
        <section
          className="grid w-full max-w-2xl gap-3 rounded-xl border border-border-weak-base bg-surface-raised-strong p-5"
          aria-label="Failed Report context"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text-strong">From this failed Report</h2>
            <Link
              className="text-sm text-text-weak underline"
              to="/runs/$runId"
              params={{ runId: contextualRunId }}
            >
              Open Report
            </Link>
          </div>
          {report.isPending ? (
            <p className="text-sm text-text-weak" role="status">
              Loading Report context…
            </p>
          ) : null}
          {report.error ? (
            <p className="text-sm text-text-weak" role="alert">
              The Report context could not be loaded. You can still start a new investigation.
            </p>
          ) : null}
          {report.data ? (
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-medium text-text-weak">Target</dt>
                <dd className="text-text-strong">
                  {report.data.targetName ?? "Target from Report"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-text-weak">Expected</dt>
                <dd className="text-text-strong">
                  {failureStep?.expected ?? "Expected result recorded in the Report"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-text-weak">Observed</dt>
                <dd className="text-text-strong">
                  {failureStep?.observed ??
                    report.data.cause ??
                    "Observed result recorded in the Report"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-text-weak">Evidence</dt>
                <dd className="text-text-strong">
                  {report.data.evidence.length
                    ? `${report.data.evidence.length} evidence references available`
                    : "No evidence reference available"}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
      <section className="w-full max-w-2xl overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-strong">
        <div className="border-b border-border-weak-base px-6 py-5">
          <h2 className="text-base font-semibold text-text-strong">Investigation details</h2>
        </div>
        <div className="px-6 py-6">
          <form onSubmit={submit} className="grid gap-6">
            <Field className="gap-2">
              <FieldLabel
                htmlFor="agent-debug-title"
                className="text-sm font-medium text-text-strong"
              >
                Bug or investigation name
              </FieldLabel>
              <Input
                id="agent-debug-title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Checkout button is unreachable"
                maxLength={160}
                required
              />
              <FieldDescription className="text-sm leading-5 text-text-weak">
                A short name for this investigation.
              </FieldDescription>
            </Field>
            <Field className="gap-2">
              <FieldLabel
                htmlFor="agent-debug-target"
                className="text-sm font-medium text-text-strong"
              >
                Target
              </FieldLabel>
              {devices.isPending ? (
                <p className="text-sm text-text-weak" role="status">
                  Loading targets…
                </p>
              ) : null}
              <Select
                items={readyDevices.map((device) => ({
                  value: device.serial,
                  label: `${device.name} · ${device.platform}`,
                }))}
                value={targetReady ? targetId : ""}
                onValueChange={(nextValue) => setTargetId(nextValue ?? "")}
              >
                <SelectTrigger id="agent-debug-target" className="w-full">
                  <SelectValue placeholder="Choose a ready target" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {readyDevices.map((device) => (
                    <SelectItem key={device.id} value={device.serial} data-value={device.serial}>
                      {device.name} · {device.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!devices.isPending && contextualTargetId === targetId && !targetReady ? (
                <p className="text-sm text-text-weak" role="status">
                  The original target is unavailable. Choose a ready device or browser to continue.
                </p>
              ) : null}
              <FieldDescription className="text-sm leading-5 text-text-weak">
                Choose a ready device or browser.
              </FieldDescription>
              {devices.data && !devices.data.some((device) => device.runnable) ? (
                <FieldError>
                  No runnable targets are available. <Link to="/devices">Open Devices</Link> to
                  reconnect a target, then try again.
                </FieldError>
              ) : null}
            </Field>
            {devices.isError ? (
              <FieldError>
                Targets could not be loaded.{" "}
                <Button variant="ghost" size="sm" onClick={() => void devices.refetch()}>
                  Try again
                </Button>
              </FieldError>
            ) : null}
            {start.error ? (
              <FieldError>
                {start.error instanceof Error
                  ? start.error.message
                  : "The investigation could not start."}
              </FieldError>
            ) : null}
            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                variant="default"
                disabled={start.isPending || !title.trim() || !targetReady}
                className="w-full sm:w-auto"
              >
                {start.isPending ? "Starting Session…" : "Start investigation"}
              </Button>
            </div>
          </form>
        </div>
      </section>

      {start.data && isStartOutcome(start.data)
        ? (() => {
            const outcome = start.data;
            return (
              <Alert role="status" variant="default" className="w-full max-w-2xl">
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Session ready for review</AlertTitle>
                <AlertDescription>Your investigation is ready to review.</AlertDescription>
                {outcome.recording.authoring?.sessionId ? (
                  <AlertAction>
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link
                          to="/sessions/$sessionId"
                          params={{ sessionId: outcome.recording.authoring.sessionId }}
                        />
                      }
                    >
                      Open Session
                    </Button>
                  </AlertAction>
                ) : null}
              </Alert>
            );
          })()
        : null}
    </section>
  );
}
