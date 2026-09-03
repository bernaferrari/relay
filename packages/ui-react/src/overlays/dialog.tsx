/** @jsxImportSource react */
import { Dialog as Primitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { useOverlayContainer } from "./overlay-root";

function Portal(props: ComponentProps<typeof Primitive.Portal>) {
  const container = useOverlayContainer();
  return <Primitive.Portal container={container} {...props} />;
}

export const Dialog = {
  Root: Primitive.Root,
  Trigger: Primitive.Trigger,
  Portal,
  Backdrop: Primitive.Backdrop,
  Viewport: Primitive.Viewport,
  Popup: Primitive.Popup,
  Title: Primitive.Title,
  Description: Primitive.Description,
  Close: Primitive.Close,
} as const;
