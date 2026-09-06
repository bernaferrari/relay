/** @jsxImportSource react */
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
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
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FormPage, PageHeader } from "../components/page-layout";

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
    if (targetId) return;
    const profileId = report.data?.executionContext?.targetProfileId;
    const byProfile = profileId
      ? readyDevices.filter((device) => device.serial === profileId || device.id === profileId)
      : [];
    if (byProfile.length === 1) {
      setTargetId(byProfile[0]!.serial);
      return;
    }
    if (!report.data?.targetName) return;
    const matchingTargets = readyDevices.filter((device) => device.name === report.data.targetName);
    if (matchingTargets.length === 1) setTargetId(matchingTargets[0]!.serial);
  }, [
    readyDevices,
    report.data?.executionContext?.targetProfileId,
    report.data?.targetName,
    targetId,
  ]);
  const start = useMutation({
    mutationFn: (input: Parameters<AgentDebugProductService["debugBug"]>[0]) =>
      agentDebugService.debugBug(input),
    onSuccess: async (outcome) => {
      if (contextualRunId) return;
      if (isStartOutcome(outcome) && outcome.recording.authoring?.sessionId) {
        await navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: outcome.recording.authoring.sessionId },
        });
      }
    },
  });
  const defaultTitle = report.data
    ? `Investigate ${report.data.title}`
    : contextualRunId
      ? "Investigate this failure"
      : "";
  const resolvedTitle = title.trim() || defaultTitle;
  const originReady = Boolean(contextualRunId && report.data && targetReady && resolvedTitle);
  const startSucceeded = Boolean(start.data && isStartOutcome(start.data));
  const hideStartForm = startSucceeded || (start.isPending && !start.error);
  const startedFromOrigin = useRef(false);

  function startInvestigation(nextTitle: string, nextTargetId: string) {
    if (!nextTitle.trim() || !readyDevices.some((device) => device.serial === nextTargetId)) return;
    const origin =
      contextualRunId && report.data
        ? {
            schemaVersion: 1 as const,
            source: {
              runId: contextualRunId,
              attempt: failureStep?.attempt ?? 1,
              stepId: failureStep?.id ?? "before-first-step",
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
      title: nextTitle.trim(),
      targetId: nextTargetId,
      confirmControl: true,
      ...(origin ? { debugOrigin: origin } : {}),
    });
  }

  useEffect(() => {
    startedFromOrigin.current = false;
  }, [contextualRunId]);
  useEffect(() => {
    if (!originReady || startedFromOrigin.current || start.isPending || start.data || start.error)
      return;
    startedFromOrigin.current = true;
    startInvestigation(resolvedTitle, targetId);
  }, [originReady, resolvedTitle, start.data, start.error, start.isPending, targetId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startInvestigation(resolvedTitle, targetId);
  }

  return (
    <FormPage>
      <PageHeader
        crumbs={[{ label: "Live", to: "/sessions" }, { label: "Investigate" }]}
        title={
          contextualRunId && report.data ? `Investigating ${report.data.title}` : "Investigate"
        }
        description={
          contextualRunId
            ? "This investigation stays bound to the original result."
            : "Name the problem, pick a device, and start capturing."
        }
      />

      {contextualRunId ? (
        <section
          className="mb-6 grid w-full max-w-2xl gap-3 rounded-xl border border-border bg-card p-5"
          aria-label="Failed result"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">From this failed result</h2>
            <Link
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              to="/runs/$runId"
              params={{ runId: contextualRunId }}
            >
              Open result
            </Link>
          </div>
          {report.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading result…
            </p>
          ) : null}
          {report.error ? (
            <p className="text-sm text-muted-foreground" role="alert">
              The result could not be loaded. You can still start a new investigation.
            </p>
          ) : null}
          {report.data ? (
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-medium text-muted-foreground">Original</dt>
                <dd className="text-foreground">
                  {[
                    report.data.targetName,
                    report.data.executionContext?.browser,
                    report.data.executionContext?.buildId
                      ? `build ${report.data.executionContext.buildId}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Configuration from this result"}
                </dd>
              </div>
              {!failureStep ? (
                <div>
                  <dt className="font-medium text-muted-foreground">Failed</dt>
                  <dd className="text-foreground">Before step 1</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-muted-foreground">Expected</dt>
                <dd className="text-foreground">
                  {failureStep?.expected ?? "Expected result from the report"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Observed</dt>
                <dd className="text-foreground">
                  {failureStep?.observed ?? report.data.cause ?? "Observed result from the report"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Evidence</dt>
                <dd className="text-foreground">
                  {report.data.evidence.length
                    ? `${report.data.evidence.length} ${report.data.evidence.length === 1 ? "item" : "items"}`
                    : "No evidence attached"}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
      {start.isPending && !startSucceeded ? (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          Starting investigation…
        </p>
      ) : null}
      {hideStartForm ? null : (
        <form onSubmit={submit} className="grid max-w-2xl gap-6">
          {contextualRunId && report.data ? null : (
            <Field className="gap-2">
              <FieldLabel htmlFor="agent-debug-title">Name</FieldLabel>
              <Input
                id="agent-debug-title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder={defaultTitle || "Checkout button is unreachable"}
                maxLength={160}
                required={!resolvedTitle}
              />
            </Field>
          )}
          <Field className="gap-2">
            <FieldLabel htmlFor="agent-debug-target">Device or browser</FieldLabel>
            {devices.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading devices…
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
                <SelectValue placeholder="Choose a ready device" />
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
              <p className="text-sm text-muted-foreground" role="status">
                The original device is unavailable. Choose another ready device or browser.
              </p>
            ) : null}
            {devices.data && !devices.data.some((device) => device.runnable) ? (
              <FieldError>
                No ready device is available. <Link to="/devices">Open devices</Link> to reconnect
                one, then try again.
              </FieldError>
            ) : null}
          </Field>
          {devices.isError ? (
            <FieldError>
              Devices could not be loaded.{" "}
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
              disabled={start.isPending || !resolvedTitle || !targetReady}
              className="w-full sm:w-auto"
            >
              {start.isPending ? "Starting…" : "Start investigation"}
            </Button>
          </div>
        </form>
      )}

      {start.data && isStartOutcome(start.data)
        ? (() => {
            const outcome = start.data;
            return (
              <Alert role="status" variant="default" className="mt-6 w-full max-w-2xl">
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Ready to review</AlertTitle>
                <AlertDescription>Your investigation is ready.</AlertDescription>
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
    </FormPage>
  );
}
