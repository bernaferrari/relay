/** @jsxImportSource react */
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@relay/ui-react";
import type { DebugBugOutcome } from "@relay/product/agent-debug";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Bug, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AgentDebugProductService } from "../data/agent-debug-product-service";
import { deviceQueryKeys } from "../data/device-product-service";
import { PageLoading } from "./recording-shared";

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
    <section className="relay-page relay-library-page relay-agent-debug-page">
      <header className="relay-library-header">
        <div>
          <p className="relay-eyebrow">Agent Debug</p>
          <h1>Investigate a bug</h1>
          <p className="relay-page-description">
            Start one bounded investigation. Relay keeps the Session, target owner, evidence, and
            human review boundary visible at every stage.
          </p>
        </div>
        <Bug aria-hidden="true" className="relay-page-header-icon" />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Start a reviewed investigation</CardTitle>
          <CardDescription>
            Starting opens a server-owned recording Session on the selected target. It does not
            approve a Test, apply a repair, or run a device action beyond the explicit recording.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="relay-form-stack">
            <Field>
              <FieldLabel htmlFor="agent-debug-title">Bug or investigation name</FieldLabel>
              <Input
                id="agent-debug-title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Checkout button is unreachable"
                maxLength={160}
                required
              />
              <FieldDescription>
                Use a concise name that will be useful in Session history.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-debug-target">Target</FieldLabel>
              {devices.isPending ? <PageLoading label="Loading targets…" /> : null}
              <select
                id="agent-debug-target"
                className="relay-select"
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
              <FieldDescription>
                Relay will fail closed if the target is unavailable or owned by another actor.
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
            <Button
              type="submit"
              variant="primary"
              disabled={start.isPending || !title.trim() || !targetId}
            >
              {start.isPending ? "Starting Session…" : "Start investigation"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {start.data && isStartOutcome(start.data)
        ? (() => {
            const outcome = start.data;
            return (
              <Alert role="status">
                <AlertIcon>
                  <ShieldCheck aria-hidden="true" />
                </AlertIcon>
                <AlertTitle>Session ready for human review</AlertTitle>
                <AlertDescription>
                  Relay created the recording Session and preserved actor attribution. Review the
                  live Session before any Test approval, repair proposal, or rerun.
                  {outcome.recording.authoring?.sessionId ? (
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
                  ) : null}
                </AlertDescription>
              </Alert>
            );
          })()
        : null}
    </section>
  );
}
