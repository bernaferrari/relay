import { Button } from "@relay/ui-react/components/button";
import { Globe, Smartphone } from "lucide-react";

/** Target choice stays reversible before recording starts. */
export function NewTestTargetMode({
  device,
  disabled,
  onChange,
}: {
  device: boolean;
  disabled: boolean;
  onChange(device: boolean): void;
}) {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted/40 p-1" aria-label="Test target">
      {[
        { device: false, label: "Website", icon: Globe },
        { device: true, label: "Phone or tablet", icon: Smartphone },
      ].map(({ device: choice, label, icon: Icon }) => (
        <Button
          key={label}
          type="button"
          variant={device === choice ? "outline" : "ghost"}
          size="lg"
          aria-pressed={device === choice}
          disabled={disabled}
          onClick={() => onChange(choice)}
        >
          <Icon aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  );
}
