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
      <div className={`grid min-w-0 gap-1.5 ${className ?? ""}`}>
        <Label className="text-xs font-medium text-foreground">{label}</Label>
        <SelectTrigger className="w-full">
          <SelectValue />
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

export function FilterSelect(props: Omit<Parameters<typeof SelectField>[0], "className">) {
  return <SelectField {...props} />;
}
