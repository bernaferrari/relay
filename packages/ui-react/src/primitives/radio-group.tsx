/** @jsxImportSource react */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { type ComponentProps, type ReactNode } from "react";
import { classNames } from "../lib/class-names";

export function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-radio-group", className(state))
          : classNames("relay-radio-group", className)
      }
      {...props}
    />
  );
}

export function RadioGroupItem<Value>({ className, ...props }: Radio.Root.Props<Value>) {
  return (
    <Radio.Root
      data-slot="radio-group-item"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-radio-group-item", className(state))
          : classNames("relay-radio-group-item", className)
      }
      {...props}
    >
      <Radio.Indicator className="relay-radio-group-indicator" />
    </Radio.Root>
  );
}

export function RadioCard<Value>({
  value,
  title,
  description,
  leading,
  className,
  disabled,
}: {
  value: Value;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={classNames("relay-radio-card", className)}
      data-disabled={disabled || undefined}
    >
      {leading ? (
        <span className="relay-radio-card-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="relay-radio-card-copy">
        <span className="relay-radio-card-title">{title}</span>
        {description ? <span className="relay-radio-card-description">{description}</span> : null}
      </span>
      <RadioGroupItem value={value} disabled={disabled} />
    </label>
  );
}

export type RadioGroupProps<Value> = RadioGroupPrimitive.Props<Value>;
export type RadioGroupItemProps<Value> = ComponentProps<typeof Radio.Root<Value>>;
