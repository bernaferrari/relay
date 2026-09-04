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
}: {
  label: string;
  value: string;
  options: readonly FilterSelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
    >
      <div className={className ?? "relay-select-field"}>
        <Label className="relay-select-field-label relay-library-filter-label">
          {label}
        </Label>
        <SelectTrigger className="relay-select-trigger">
          <SelectValue />
        </SelectTrigger>
      </div>
      <SelectContent sideOffset={6} alignItemWithTrigger={false} className="relay-select-popup">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="relay-select-item">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterSelect(props: Omit<Parameters<typeof SelectField>[0], "className">) {
  return <SelectField {...props} className="relay-library-filter" />;
}
