/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Textarea } from "@relay/ui-react/components/textarea";
import { catalogQueryKeys } from "../data/catalog-queries";

export function NativeDescribeTest({
  appId,
  originApplication,
  disabled = false,
  onBusyChange,
}: {
  appId: string;
  originApplication: string;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const [goal, setGoal] = useState("");
  const { testEditorService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: async () => {
      if (!appId || !originApplication.trim() || !goal.trim())
        throw new Error("Choose an app and describe what should work.");
      if (!testEditorService.draftSteps || !testEditorService.createDraft)
        throw new Error("This Relay version cannot write steps yet.");
      const drafted = await testEditorService.draftSteps({ appMapId: appId, goal: goal.trim() });
      if (!drafted.steps.length) throw new Error("Describe at least one thing to do or check.");
      return testEditorService.createDraft({
        appMapId: appId,
        testId: `test-${crypto.randomUUID()}`,
        name: drafted.name,
        steps: drafted.steps,
        originApplication: originApplication.trim(),
      });
    },
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.tests });
      await navigate({ to: "/tests/$testId", params: { testId: document.test.id } });
    },
  });
  useEffect(() => {
    onBusyChange?.(create.isPending);
    return () => onBusyChange?.(false);
  }, [create.isPending, onBusyChange]);
  if (!testEditorService.draftSteps || !testEditorService.createDraft) return null;
  return (
    <section className="grid gap-2 border-t border-border pt-4" aria-label="Describe a device test">
      <label htmlFor="native-test-goal" className="text-sm font-medium">
        What should work?
      </label>
      <Textarea
        id="native-test-goal"
        value={goal}
        disabled={disabled || create.isPending}
        onChange={(event) => setGoal(event.currentTarget.value)}
        placeholder="Send a message and check that a reply appears."
        rows={3}
      />
      <Button
        type="button"
        variant="outline"
        disabled={
          disabled || create.isPending || !appId || !originApplication.trim() || !goal.trim()
        }
        onClick={() => create.mutate()}
      >
        {create.isPending ? "Writing test…" : "Create from description"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Review the Action and Check steps before running. You can record a step later to make it
        exact.
      </p>
      {create.error ? (
        <p role="alert" className="text-sm text-destructive">
          {create.error.message}
        </p>
      ) : null}
    </section>
  );
}
