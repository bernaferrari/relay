/** @jsxImportSource react */
import { Collapsible as Primitive } from "@base-ui/react/collapsible";
import type { ComponentProps } from "react";

function Root({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root className={`relay-disclosure${className ? ` ${className}` : ""}`} {...props} />
  );
}

function Trigger({ className, children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={`relay-disclosure-trigger${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="m4.5 6 3.5 3.5L11.5 6" />
      </svg>
    </Primitive.Trigger>
  );
}

function Panel({ className, ...props }: ComponentProps<typeof Primitive.Panel>) {
  return (
    <Primitive.Panel
      className={`relay-disclosure-panel${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

/** Accessible, composable disclosure built on Base UI Collapsible. */
export const Disclosure = { Root, Trigger, Panel } as const;
