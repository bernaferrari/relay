/** @jsxImportSource react */
import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";
import { useOverlayContainer } from "./overlay-root";

function Portal(props: ComponentProps<typeof Primitive.Portal>) {
  const container = useOverlayContainer();
  return <Primitive.Portal container={container} {...props} />;
}

export const Tooltip = {
  Root: Primitive.Root,
  Trigger: Primitive.Trigger,
  Portal,
  Positioner: Primitive.Positioner,
  Popup: Primitive.Popup,
} as const;
