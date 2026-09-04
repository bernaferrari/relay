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
          ? (state) => classNames("relay-radio-group grid min-w-0 gap-2", className(state))
          : classNames("relay-radio-group grid min-w-0 gap-2", className)
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
          ? (state) =>
              classNames(
                "relay-radio-group-item relative grid size-4 shrink-0 place-items-center rounded-full border border-border-base bg-background-strong text-[var(--button-primary-foreground)] outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--relay-focus-ring)] data-[checked]:border-[var(--button-primary-base)] data-[checked]:bg-[var(--button-primary-base)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none",
                className(state),
              )
          : classNames(
              "relay-radio-group-item relative grid size-4 shrink-0 place-items-center rounded-full border border-border-base bg-background-strong text-[var(--button-primary-foreground)] outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--relay-focus-ring)] data-[checked]:border-[var(--button-primary-base)] data-[checked]:bg-[var(--button-primary-base)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 motion-reduce:transition-none",
              className,
            )
      }
      {...props}
    >
      <Radio.Indicator className="relay-radio-group-indicator size-1.5 rounded-full bg-current" />
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
      className={classNames(
        "relay-radio-card group flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border-weak-base bg-surface-raised-strong px-3 py-2.5 text-text-base outline-none transition-[background-color,border-color,box-shadow,color] duration-150 ease-out hover:[&:not([data-disabled])]:bg-surface-raised-strong-hover data-[disabled]:cursor-not-allowed data-[disabled]:bg-input-disabled data-[disabled]:text-text-weaker data-[disabled]:opacity-70 motion-reduce:transition-none [&:has([data-checked])]:border-border-strong-base [&:has(:focus-visible)]:outline-2 [&:has(:focus-visible)]:outline-offset-2 [&:has(:focus-visible)]:outline-[var(--relay-focus-ring)]",
        className,
      )}
      data-disabled={disabled || undefined}
    >
      <RadioGroupItem value={value} disabled={disabled} />
      {leading ? (
        <span
          className="relay-radio-card-leading flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-base text-text-weak [&_svg]:size-4 [&_svg]:shrink-0"
          aria-hidden="true"
        >
          {leading}
        </span>
      ) : null}
      <span className="relay-radio-card-copy grid min-w-0 flex-1 gap-0.5">
        <span className="relay-radio-card-title truncate text-[13px] font-medium leading-tight text-text-strong">
          {title}
        </span>
        {description ? (
          <span className="relay-radio-card-description truncate text-xs leading-snug text-text-weak">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export type RadioGroupProps<Value> = RadioGroupPrimitive.Props<Value>;
export type RadioGroupItemProps<Value> = ComponentProps<typeof Radio.Root<Value>>;
