import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { SelectField } from "../components/filter-select";
import type {
  PlanInputBindingService,
  ProductPlanInputBindingChoice,
  ProductPlanInputBindingRequest,
} from "../data/plan-input-binding-service";

export type PlanInputBindingDraft = {
  requestKey: string;
  bindings: ProductPlanInputBindingChoice[];
  selectedOptionIds: string[];
  ready: boolean;
};

/** Exact saved action addresses remain local draft choices until Apply. */
export function PlanInputBindingChoices({
  service,
  request,
  requestKey,
  disabled,
  onChange,
}: {
  service: PlanInputBindingService;
  request: ProductPlanInputBindingRequest;
  requestKey: string;
  disabled: boolean;
  onChange(draft: PlanInputBindingDraft): void;
}) {
  const preview = useQuery({
    queryKey: ["suites", "input-bindings", requestKey],
    queryFn: () => service.previewInputBindings(request),
    retry: false,
    staleTime: 0,
  });
  const [choices, setChoices] = useState<Record<string, ProductPlanInputBindingChoice>>({});
  const [rows, setRows] = useState<string[]>();
  useEffect(() => {
    const data = preview.data;
    if (!data) return;
    setChoices((current) => {
      const next = { ...current };
      for (const test of data.tests) {
        const action = test.actions[0];
        if (!next[test.id] && test.actions.length === 1 && action)
          next[test.id] = {
            testId: test.id,
            stepId: action.stepId,
            actionKey: action.key,
            text: action.text,
          };
      }
      return next;
    });
    setRows((current) => current ?? data.options.map((option) => option.id));
  }, [preview.data]);
  useEffect(() => {
    const tests = preview.data?.tests ?? [];
    const bindings = tests.flatMap((test) => {
      const choice = choices[test.id];
      return choice &&
        test.actions.some(
          (action) =>
            action.key === choice.actionKey &&
            action.stepId === choice.stepId &&
            action.text === choice.text,
        )
        ? [choice]
        : [];
    });
    const selectedOptionIds = (rows ?? []).filter((id) =>
      preview.data?.options.some((row) => row.id === id),
    );
    onChange({
      requestKey,
      bindings,
      selectedOptionIds,
      ready: Boolean(
        preview.data &&
        !preview.isFetching &&
        bindings.length &&
        selectedOptionIds.length &&
        tests.every(
          (test) => !test.actions.length || bindings.some((choice) => choice.testId === test.id),
        ),
      ),
    });
  }, [choices, rows, preview.data, preview.isFetching, requestKey, onChange]);
  if (preview.isPending)
    return (
      <p role="status" className="text-sm">
        Loading test text actions…
      </p>
    );
  if (preview.error)
    return (
      <FieldError>
        {preview.error instanceof Error
          ? preview.error.message
          : "Could not load test text actions."}
      </FieldError>
    );
  if (!preview.data) return null;
  return (
    <div className="grid min-w-0 gap-4 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        Choose the text action each test will read from these saved values.
      </p>
      {!preview.data.tests.length ? (
        <p className="text-sm">Select tests for this plan first.</p>
      ) : null}
      {preview.data.tests.map((test) => {
        const choice = choices[test.id];
        const action = choice
          ? test.actions.find(
              (item) =>
                item.key === choice.actionKey &&
                item.stepId === choice.stepId &&
                item.text === choice.text,
            )
          : undefined;
        return (
          <fieldset key={test.id} className="grid min-w-0 gap-2">
            <legend className="mb-2 text-sm font-medium">{test.name}</legend>
            {!test.actions.length ? (
              <p className="text-xs text-muted-foreground">
                This test has no eligible text action. Its steps stay unchanged.
              </p>
            ) : (
              <>
                <SelectField
                  label={`Text action for ${test.name}`}
                  value={action ? JSON.stringify([action.stepId, action.key]) : ""}
                  placeholder="Choose a text action"
                  disabled={disabled || preview.isFetching}
                  options={test.actions.map((item) => ({
                    value: JSON.stringify([item.stepId, item.key]),
                    label: `${item.stepTitle} · ${item.text.length > 72 ? `${item.text.slice(0, 71)}…` : item.text}`,
                  }))}
                  onValueChange={(value) => {
                    const selected = test.actions.find(
                      (item) => JSON.stringify([item.stepId, item.key]) === value,
                    );
                    if (selected)
                      setChoices((current) => ({
                        ...current,
                        [test.id]: {
                          testId: test.id,
                          stepId: selected.stepId,
                          actionKey: selected.key,
                          text: selected.text,
                        },
                      }));
                  }}
                />
                {action ? (
                  <div className="grid min-w-0 gap-2 rounded-md bg-background p-3 text-xs">
                    <p className="font-medium">Before</p>
                    <pre className="whitespace-pre-wrap break-words font-sans leading-5">
                      {action.text}
                    </pre>
                    <p className="font-medium">After · selected prompt value</p>
                    <code className="break-all">{preview.data.token}</code>
                    {action.sharedTestNames.length ? (
                      <p className="leading-5">
                        This also changes the shared text action in:{" "}
                        {action.sharedTestNames.join(", ")}.
                      </p>
                    ) : null}
                    {action.sharedSteps.length ? (
                      <p className="leading-5">
                        Other instructions using this action:{" "}
                        {action.sharedSteps
                          .map((step) => `${step.testName} — ${step.stepTitle}`)
                          .join("; ")}
                        .
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </fieldset>
        );
      })}
      <fieldset aria-label="Values for this plan" className="grid max-h-64 gap-2 overflow-y-auto">
        <legend className="mb-2 text-sm font-medium">Values for this plan</legend>
        {preview.data.options.map((option, index) => (
          <FieldLabel
            key={option.id}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md bg-background p-3"
          >
            <Checkbox
              checked={rows?.includes(option.id) ?? false}
              disabled={disabled || preview.isFetching}
              onCheckedChange={(checked) =>
                setRows((current) =>
                  checked === true
                    ? [...(current ?? []), option.id]
                    : (current ?? []).filter((id) => id !== option.id),
                )
              }
            />
            <span className="grid min-w-0 gap-1">
              <span className="text-xs text-muted-foreground tabular-nums">Value {index + 1}</span>
              <span className="whitespace-pre-wrap break-words text-sm font-normal leading-5">
                {option.value}
              </span>
            </span>
          </FieldLabel>
        ))}
      </fieldset>
    </div>
  );
}
