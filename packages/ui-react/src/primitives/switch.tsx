/** @jsxImportSource react */
import { Switch as Primitive } from "@base-ui/react/switch";
import { forwardRef } from "react";
import { classNames } from "../lib/class-names";

export type SwitchProps = Primitive.Root.Props;

export const Switch = forwardRef<HTMLElement, SwitchProps>(function Switch(
  { className, ...props },
  ref,
) {
  return (
    <Primitive.Root
      ref={ref}
      data-slot="switch"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-switch", className(state))
          : classNames("relay-switch", className)
      }
      {...props}
    >
      <Primitive.Thumb data-slot="switch-thumb" className="relay-switch-thumb" />
    </Primitive.Root>
  );
});
