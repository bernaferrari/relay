/** @jsxImportSource react */
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@relay/ui-react";
import type { DebugBugOutcome } from "@relay/product/agent-debug";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import { deviceQueryKeys } from "../data/device-product-service";

function isStartOutcome(
  value: DebugBugOutcome | undefined,
): value is Extract<DebugBugOutcome, { action: "start" }> {
  return value?.action === "start";
}

export function AgentDebugPage() {
  const { agentDebugService, deviceService } = useRouteContext({ from: "__root__" });
  const [title, setTitle] = useState("");
  const [targetId, setTargetId] = useState("");
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
  });
  const start = useMutation({
    mutationFn: (input: Parameters<AgentDebugProductService["debugBug"]>[0]) =>
      agentDebugService.debugBug(input),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !targetId) return;
    start.mutate({
      kind: "debug-bug",
      action: "start",
      title: title.trim(),
      targetId,
      confirmControl: true,
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
      <header className="max-w-2xl space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-weak">Agent Debug</p>
        <h1 className="text-3xl font-semibold tracking-tight text-text-strong">
          Investigate a bug
        </h1>
        <p className="max-w-prose text-base leading-7 text-text-weak">
          Capture a reproducible path and review the evidence with your team.
        </p>
      </header>

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
                className="h-9 text-base"
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
              <select
                id="agent-debug-target"
                className="h-9 w-full rounded-md border border-border-base bg-input-base px-3 text-base text-text-strong shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-border-focus focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                value={targetId}
                onChange={(event) => setTargetId(event.currentTarget.value)}
                required
              >
                <option value="">Choose a ready target</option>
                {(devices.data ?? [])
                  .filter((device) => device.runnable)
                  .map((device) => (
                    <option key={device.id} value={device.serial}>
                      {device.name} · {device.platform}
                    </option>
                  ))}
              </select>
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
              <FieldError>Targets could not be loaded. Check Devices and retry.</FieldError>
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
                variant="primary"
                disabled={start.isPending || !title.trim() || !targetId}
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
              <Alert role="status" variant="success" className="w-full max-w-2xl">
                <AlertIcon>
                  <ShieldCheck aria-hidden="true" />
                </AlertIcon>
                <AlertTitle>Session ready for review</AlertTitle>
                <AlertDescription>Your investigation is ready to review.</AlertDescription>
                {outcome.recording.authoring?.sessionId ? (
                  <AlertActions>
                    <Button
                      variant="secondary"
                      render={
                        <Link
                          to="/sessions/$sessionId"
                          params={{ sessionId: outcome.recording.authoring.sessionId }}
                        />
                      }
                    >
                      Open Session
                    </Button>
                  </AlertActions>
                ) : null}
              </Alert>
            );
          })()
        : null}
    </section>
  );
}
