/** @jsxImportSource react */
import { ReadableStep } from "./saved-test-steps";
import type { ProductTestStep } from "@relay/product/catalog";
/** The Test outline pane: readable steps with keyboard-driven selection.
 * Extracted from the Test route to respect the component source budget; the
 * route passes the projected steps and the current evidence selection. */
export function TestStepsOutline({
  title,
  hint,
  steps,
  selectedId,
  onSelect,
}: {
  steps: readonly ProductTestStep[];
  title: string;
  hint?: string;
  selectedId?: string;
  onSelect(id: string): void;
}) {
  return (
    <section
      className="min-w-0 p-3"
      aria-labelledby="test-overview-title"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-step-id]"),
        ];
        if (!buttons.length) return;
        event.preventDefault();
        const focused = buttons.findIndex((button) => button === document.activeElement);
        const selected = buttons.findIndex((button) => button.dataset.stepId === selectedId);
        const current = focused >= 0 ? focused : selected;
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
                );
        buttons[next]!.focus({ preventScroll: true });
        buttons[next]!.click();
        buttons[next]!.scrollIntoView({ block: "nearest" });
      }}
    >
      <h2
        id="test-overview-title"
        tabIndex={0}
        className="mb-2 text-sm font-medium text-muted-foreground"
      >
        {title}
      </h2>
      {hint ? <p className="mb-2 text-xs text-muted-foreground">{hint}</p> : null}
      {steps.length ? (
        <ol data-slot="test-readable-steps" className="mt-3 grid list-none gap-1 p-0">
          {steps.map((step, index) => (
            <ReadableStep
              key={step.id}
              step={step}
              number={String(index + 1)}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">This test has no reviewed steps yet.</p>
      )}
    </section>
  );
}
