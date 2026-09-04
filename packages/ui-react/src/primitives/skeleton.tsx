/** @jsxImportSource react */
import { forwardRef, type HTMLAttributes } from "react";
import { classNames } from "../lib/class-names";

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="skeleton"
        className={classNames("relay-skeleton", className)}
        aria-hidden="true"
        {...props}
      />
    );
  },
);
