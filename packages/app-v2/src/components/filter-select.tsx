/** @jsxImportSource react */
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@relay/ui-react/components/select";
import { Label } from "@relay/ui-react/components/label";

export type FilterSelectOption = {
  value: string;
  label: string;
};

export function SelectField({
  label,
  value,
  options,
  onValueChange,
  className,
  placeholder,
  compact = false,
  disabled = false,
  id,
}: {
  label: string;
  value: string;
  options: readonly FilterSelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  if (!options.length) {
    return (
      <div className={compact ? className : `grid min-w-0 gap-1.5 ${className ?? ""}`}>
        {compact ? null : <Label className="text-xs font-medium text-foreground">{label}</Label>}
        <div
          className="flex h-8 items-center rounded-lg border border-dashed border-input px-2.5 text-sm text-muted-foreground"
          aria-label={label}
        >
          {placeholder ?? "None available"}
        </div>
      </div>
    );
  }
  return (
    <Select
      disabled={disabled}
      items={options}
      value={options.some((option) => option.value === value) ? value : null}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
    >
      <div className={compact ? className : `grid min-w-0 gap-1.5 ${className ?? ""}`}>
        {compact ? null : <Label className="text-xs font-medium text-foreground">{label}</Label>}
        <SelectTrigger
          id={id}
          className={
            compact ? "w-auto min-w-35" : "w-full min-w-0 [&_[data-slot=select-value]]:truncate"
          }
          aria-label={label}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
      </div>
      <SelectContent sideOffset={6} alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterSelect(
  props: Omit<Parameters<typeof SelectField>[0], "className"> & { className?: string },
) {
  return <SelectField {...props} />;
}
