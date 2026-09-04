/** @jsxImportSource react */
import { Progress as Primitive } from "@base-ui/react/progress";
import type { ComponentProps } from "react";
import { classNames } from "../lib/class-names";

export function Progress({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="progress"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-progress", className(state))
          : classNames("relay-progress", className)
      }
      {...props}
    />
  );
}

export function ProgressLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      data-slot="progress-label"
      className={classNames("relay-progress-label", className as string)}
      {...props}
    />
  );
}

export function ProgressValue({ className, ...props }: ComponentProps<typeof Primitive.Value>) {
  return (
    <Primitive.Value
      data-slot="progress-value"
      className={classNames("relay-progress-value", className as string)}
      {...props}
    />
  );
}

export function ProgressTrack({ className, ...props }: ComponentProps<typeof Primitive.Track>) {
  return (
    <Primitive.Track
      data-slot="progress-track"
      className={classNames("relay-progress-track", className as string)}
      {...props}
    >
      <Primitive.Indicator data-slot="progress-indicator" className="relay-progress-indicator" />
    </Primitive.Track>
  );
}
