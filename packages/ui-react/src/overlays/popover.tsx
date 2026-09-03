/** @jsxImportSource react */
import { Popover as Primitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { useOverlayContainer } from "./overlay-root";

function Portal(props: ComponentProps<typeof Primitive.Portal>) {
  const container = useOverlayContainer();
  return <Primitive.Portal container={container} {...props} />;
}

export const Popover = {
  Root: Primitive.Root,
  Trigger: Primitive.Trigger,
  Portal,
  Positioner: Primitive.Positioner,
  Popup: Primitive.Popup,
  Title: Primitive.Title,
  Description: Primitive.Description,
  Close: Primitive.Close,
} as const;
