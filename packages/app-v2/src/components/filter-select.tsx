/** @jsxImportSource react */
import { Select } from "@relay/ui-react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

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
    <Select.Root
      items={options}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
    >
      <div className={className ?? "relay-select-field"}>
        <Select.Label className="relay-select-field-label relay-library-filter-label">
          {label}
        </Select.Label>
        <Select.Trigger className="relay-select-trigger">
          <Select.Value />
          <Select.Icon className="relay-select-icon">
            <ChevronDown aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner
          className="relay-select-positioner"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="relay-select-popup">
            <Select.ScrollUpArrow className="relay-select-scroll-arrow">
              <ChevronUp aria-hidden="true" />
            </Select.ScrollUpArrow>
            <Select.List className="relay-select-list">
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="relay-select-item">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="relay-select-item-indicator">
                    <Check aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
            <Select.ScrollDownArrow className="relay-select-scroll-arrow">
              <ChevronDown aria-hidden="true" />
            </Select.ScrollDownArrow>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function FilterSelect(props: Omit<Parameters<typeof SelectField>[0], "className">) {
  return <SelectField {...props} className="relay-library-filter" />;
}
