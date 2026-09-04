/** @jsxImportSource react */
import { forwardRef, type ComponentProps } from "react";
import { classNames } from "../lib/class-names";

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={classNames("relay-textarea", className)}
        {...props}
      />
    );
  },
);
