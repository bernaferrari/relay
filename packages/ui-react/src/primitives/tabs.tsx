/** @jsxImportSource react */
import { Tabs as Primitive } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { classNames } from "../lib/class-names";

export function Tabs({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      data-slot="tabs"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-tabs", className(state))
          : classNames("relay-tabs", className)
      }
      {...props}
    />
  );
}

export function TabsList({
  className,
  variant = "default",
  ...props
}: ComponentProps<typeof Primitive.List> & { variant?: "default" | "line" }) {
  return (
    <Primitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={
        typeof className === "function"
          ? (state) => classNames("relay-tabs-list", className(state))
          : classNames("relay-tabs-list", className)
      }
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Tab>) {
  return (
    <Primitive.Tab
      data-slot="tabs-trigger"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-tabs-trigger", className(state))
          : classNames("relay-tabs-trigger", className)
      }
      {...props}
    />
  );
}

export function TabsIndicator({ className, ...props }: ComponentProps<typeof Primitive.Indicator>) {
  return (
    <Primitive.Indicator
      data-slot="tabs-indicator"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-tabs-indicator", className(state))
          : classNames("relay-tabs-indicator", className)
      }
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Panel>) {
  return (
    <Primitive.Panel
      data-slot="tabs-content"
      className={
        typeof className === "function"
          ? (state) => classNames("relay-tabs-content", className(state))
          : classNames("relay-tabs-content", className)
      }
      {...props}
    />
  );
}
