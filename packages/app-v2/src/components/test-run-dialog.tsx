/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { FieldLabel } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import type { ProductTestSummary } from "@relay/product/catalog";
import { runQueryKeys } from "../data/run-queries";
import type { RunProductService } from "../data/run-product-service";
import type { ProductRunState } from "@relay/product/run-journey";
import { writeRunPointer } from "../data/run-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "../routes/recording-shared";

type RecoveryRun = {
  workflowId: string;
  started: ProductRunState;
  runId?: string;
  durable?: Awaited<ReturnType<RunProductService["inspect"]>>;
};

export function TestRunDialog({ test }: { test: ProductTestSummary }) {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [recoveryRun, setRecoveryRun] = useState<RecoveryRun>();
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
    enabled: open,
  });
  const start = useMutation({
    mutationFn: async () => {
      if (!targetId) throw new TypeError("Choose a ready device or browser for this Run.");
      let current = recoveryRun;
      let started = current?.started;
      if (!current) {
        const response = await runService.start({
          testId: test.id,
          appMapId: test.appMapId,
          targetId,
        });
        const workflowId = response.workflow?.workflowId;
        if (!workflowId) throw new TypeError("Relay could not start this Run.");
        current = { workflowId, started: response };
        setRecoveryRun(current);
        started = response;
      }
      const canonical = current.durable ?? (await runService.inspect(current.workflowId));
      const runId = canonical.run?.runId ?? started?.run?.runId;
      if (!runId) throw new TypeError("Relay could not open the new Run.");
      const durable = canonical.run?.runId ? canonical : { ...canonical, run: started?.run };
      setRecoveryRun({ ...current, runId, durable });
      await writeRunPointer(platform, { workflowId: current.workflowId, runId, testId: test.id });
      queryClient.setQueryData(runQueryKeys.pointer, {
        workflowId: current.workflowId,
        runId,
        testId: test.id,
      });
      queryClient.setQueryData(runQueryKeys.workflow(current.workflowId), durable);
      return runId;
    },
    onSuccess: async (runId) => {
      await navigate({ to: "/runs/$runId", params: { runId } });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !start.isPending && setOpen(next)}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Run</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="relay-test-run-dialog w-[min(560px,calc(100vw-32px))]"
      >
        <DialogTitle>Run {test.name}</DialogTitle>
        <DialogDescription>Choose a ready device or browser for this Test.</DialogDescription>
        {targets.isPending ? <PageLoading label="Loading ready devices and browsers…" /> : null}
        {recoveryRun && !recoveryRun.runId ? (
          <p role="status">Run started. Retry to finish opening it.</p>
        ) : null}
        <RecordingProblem
          error={targets.error ?? start.error}
          onRetry={() => (start.error ? start.mutate() : void targets.refetch())}
          retrying={targets.isFetching || start.isPending}
        />
        {targets.data?.length ? (
          <RadioGroup value={targetId} onValueChange={setTargetId} aria-label="Run target">
            {targets.data.map((target) => {
              const label = targetLabel(target);
              return (
                <FieldLabel
                  key={`${target.kind}:${target.targetId}`}
                  className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <RadioGroupItem
                    value={target.targetId}
                    disabled={start.isPending || Boolean(recoveryRun)}
                  />
                  <span>
                    <strong>{label.title}</strong>
                    <small className="block text-muted-foreground">{label.detail}</small>
                  </span>
                </FieldLabel>
              );
            })}
          </RadioGroup>
        ) : null}
        {!targets.isPending && !targets.error && !targets.data?.length ? (
          <p>No ready device or browser is available.</p>
        ) : null}
        <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
          <DialogClose
            render={
              <Button variant="ghost" disabled={start.isPending}>
                Cancel
              </Button>
            }
          />
          <Button disabled={!targetId || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Starting…" : "Start Run"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
