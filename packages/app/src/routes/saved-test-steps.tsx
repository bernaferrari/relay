import { CircleAlert } from "lucide-react";
import { TestStepButton } from "../components/test-workspace";
import type { ProductTestStep } from "@relay/product/catalog";
export function ReadableStep({
  step,
  number,
  selectedId,
  onSelect,
}: {
  step: ProductTestStep;
  number: string;
  selectedId: string | undefined;
  onSelect(stepId: string): void;
}) {
  return (
    <li data-selected={selectedId === step.id}>
      <TestStepButton
        number={number}
        selected={selectedId === step.id}
        data-step-id={step.id}
        onClick={() => onSelect(step.id)}
      >
        <strong className="block text-sm font-medium">{step.label ?? step.intent}</strong>
        {step.status === "needs-review" ? (
          <small className="mt-0.5 flex items-center gap-1 text-xs text-warning-foreground">
            <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
            Needs setup
          </small>
        ) : null}
      </TestStepButton>
      {step.children?.length ? (
        <ol className="col-span-2 ml-5 grid list-none gap-0 p-0">
          {step.children.map((child, index) => (
            <ReadableStep
              key={child.id}
              step={child}
              number={`${number}.${index + 1}`}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function flattenSteps(steps: readonly ProductTestStep[]): readonly ProductTestStep[] {
  return steps.flatMap((step) => [step, ...flattenSteps(step.children ?? [])]);
}

export function formatRunDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
