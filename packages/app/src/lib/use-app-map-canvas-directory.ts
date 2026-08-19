import { createMemo, type Accessor } from "solid-js";
import type { MapTreeNode } from "./app-map-tree";
import type { CanvasConnection } from "./app-map-connection-draft";
import { resolveScreenTitle } from "./app-map-workspace-helpers";
import { screenDirectoryFromGraph, type ScreenDirectory } from "./app-map-screen-directory";

/** Naming for the canvas. Six frames all called "Appearance" are six
 * indistinguishable objects, so the canvas reads the same directory the Screens
 * grid does — the two surfaces cannot disagree about a screen's identity. */
export function useAppMapCanvasDirectory(input: {
  nodes: Accessor<MapTreeNode[]>;
  connections: Accessor<CanvasConnection[]>;
  screenTitles: Accessor<Record<string, string> | undefined>;
}): {
  titleFor: (node: MapTreeNode) => string;
  titleForScreen: (screenId: string) => string;
  directory: Accessor<ScreenDirectory>;
} {
  const titleFor = (node: MapTreeNode) => resolveScreenTitle(node, input.screenTitles());
  const titleForScreen = (screenId: string) => {
    const node = input.nodes().find((candidate) => candidate.id === screenId);
    return node ? titleFor(node) : "Untitled screen";
  };
  const directory = createMemo(() =>
    screenDirectoryFromGraph({
      screenIds: input.nodes().map((node) => node.id),
      titleFor: titleForScreen,
      edges: input.connections().map((connection) => ({
        from: connection.fromScreenId,
        to: connection.toScreenId,
      })),
    }),
  );
  return { titleFor, titleForScreen, directory };
}
