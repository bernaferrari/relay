/** @jsxImportSource react */
import { Menu as Primitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { useOverlayContainer } from "./overlay-root";

function Portal(props: ComponentProps<typeof Primitive.Portal>) {
  const container = useOverlayContainer();
  return <Primitive.Portal container={container} {...props} />;
}

export const Menu = {
  Root: Primitive.Root,
  Trigger: Primitive.Trigger,
  Portal,
  Positioner: Primitive.Positioner,
  Popup: Primitive.Popup,
  Item: Primitive.Item,
  LinkItem: Primitive.LinkItem,
  Group: Primitive.Group,
  GroupLabel: Primitive.GroupLabel,
  Separator: Primitive.Separator,
} as const;
