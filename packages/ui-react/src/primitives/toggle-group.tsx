/** @jsxImportSource react */
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as Primitive } from "@base-ui/react/toggle-group";
import type { ComponentProps } from "react";
import { classNames } from "../lib/class-names";

type SingleToggleGroupProps = Omit<
  Primitive.Props<string>,
  "defaultValue" | "multiple" | "onValueChange" | "value"
> & {
  type: "single";
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

type MultipleToggleGroupProps = Omit<Primitive.Props<string>, "multiple"> & {
  type: "multiple";
};

export function ToggleGroup({
  className,
  ...props
}: SingleToggleGroupProps | MultipleToggleGroupProps) {
  const shared = {
    className:
      typeof className === "function"
        ? (state: Primitive.State) => classNames("relay-toggle-group", className(state))
        : classNames("relay-toggle-group", className),
  };

  if (props.type === "single") {
    const { defaultValue, onValueChange, type: _type, value, ...rootProps } = props;
    return (
      <Primitive
        data-slot="toggle-group"
        {...shared}
        {...rootProps}
        multiple={false}
        value={value === undefined ? undefined : [value]}
        defaultValue={defaultValue === undefined ? undefined : [defaultValue]}
        onValueChange={(next) => {
          const selected = next[0];
          if (selected !== undefined) onValueChange?.(selected);
        }}
      />
    );
  }

  const { type: _type, ...rootProps } = props;
  return <Primitive data-slot="toggle-group" {...shared} {...rootProps} multiple />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof Toggle<string>>) {
  return (
    <Toggle
      data-slot="toggle-group-item"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-toggle-group-item", className(state))
          : classNames("relay-toggle-group-item", className)
      }
      {...props}
    />
  );
}
