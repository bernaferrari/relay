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
    <li
      className="grid grid-cols-[28px_minmax(0,1fr)] rounded-md px-2 data-[selected=true]:bg-accent/60"
      data-selected={selectedId === step.id}
    >
      <span className="grid place-items-center text-[11px] tabular-nums text-muted-foreground">
        {number}
      </span>
      <button
        className="min-w-0 rounded-md px-1 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        aria-pressed={selectedId === step.id}
        data-step-id={step.id}
        onClick={() => onSelect(step.id)}
      >
        <strong className="block text-[13px] font-medium">{step.label ?? step.intent}</strong>
        {step.status === "needs-review" ? (
          <small className="mt-0.5 block text-xs text-muted-foreground">Needs setup</small>
        ) : null}
      </button>
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
