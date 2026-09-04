/** @jsxImportSource react */
import { Select as Primitive } from "@base-ui/react/select";
import type { ComponentProps } from "react";
import { useOverlayContainer } from "../overlays/overlay-root";

function Portal(props: ComponentProps<typeof Primitive.Portal>) {
  const container = useOverlayContainer();
  return <Primitive.Portal container={container} {...props} />;
}

/** Accessible Select parts with portals kept inside Relay's overlay root. */
export const Select = {
  Root: Primitive.Root,
  Label: Primitive.Label,
  Trigger: Primitive.Trigger,
  Value: Primitive.Value,
  Icon: Primitive.Icon,
  Portal,
  Positioner: Primitive.Positioner,
  Popup: Primitive.Popup,
  List: Primitive.List,
  Item: Primitive.Item,
  ItemText: Primitive.ItemText,
  ItemIndicator: Primitive.ItemIndicator,
  ScrollUpArrow: Primitive.ScrollUpArrow,
  ScrollDownArrow: Primitive.ScrollDownArrow,
} as const;
