import { Button } from "@relay/ui-react/components/button";

/** Exactly one screenshot moment is selected; clicking it cannot clear selection. */
export function ScreenshotMomentSwitch<Value extends string>({
  items,
  value,
  onChange,
  label = "Screenshot moment",
}: {
  items: readonly { value: Value; label: string }[];
  value: Value;
  onChange(value: Value): void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 gap-1 rounded-lg bg-muted/40 p-1"
    >
      {items.map((item) => (
        <Button
          key={item.value}
          type="button"
          size="lg"
          variant={value === item.value ? "outline" : "ghost"}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
