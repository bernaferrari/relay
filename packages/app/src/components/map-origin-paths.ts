import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import type { PresentedMapPath } from "./map-presentation";
import type { ImageDimensions } from "./map-canvas-geometry";
import { accessibilityControls } from "./map-accessibility-overlay";

/** Project accessible source controls into map path anchors for the overlay. */
export function useMapOriginPaths(
  visibleScreens: readonly ProductMapScreen[],
  visiblePaths: readonly PresentedMapPath[],
  imageDimensions: ReadonlyMap<string, ImageDimensions>,
  showControlOrigins: boolean,
  loadAccessibilityTree?: (uri: string) => Promise<unknown>,
): PresentedMapPath[] {
  const treeValues = useQueries({
    queries: visibleScreens.map((screen) => ({
      queryKey: ["map-accessibility", screen.accessibilityTreeUri],
      queryFn: () => loadAccessibilityTree!(screen.accessibilityTreeUri!),
      enabled: Boolean(showControlOrigins && screen.accessibilityTreeUri && loadAccessibilityTree),
      staleTime: Infinity,
      retry: false,
    })),
    combine: (results) => results.map((result) => result.data),
  });
  const controlsByScreen = useMemo(
    () =>
      new Map(
        visibleScreens.map((screen, index) => {
          const dimensions = imageDimensions.get(screen.id);
          return [
            screen.id,
            dimensions ? accessibilityControls(treeValues[index], dimensions) : [],
          ] as const;
        }),
      ),
    [visibleScreens, treeValues, imageDimensions],
  );
  const originPaths = visiblePaths.map((path) => {
    if (!showControlOrigins || path.sourceAnchor || !path.sourceTarget) return path;
    const target = path.sourceTarget;
    const controls = controlsByScreen.get(path.fromScreenId) ?? [];
    const matches = controls.filter((control) =>
      target.identifier
        ? control.identifier === target.identifier
        : control.label === (target.label ?? target.text),
    );
    const unique = [
      ...new Map(
        matches.map((control) => [
          `${control.x},${control.y},${control.width},${control.height}`,
          control,
        ]),
      ).values(),
    ];
    if (unique.length !== 1) return path;
    const rect = unique[0]!;
    return {
      ...path,
      sourceAnchor: { point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, rect },
    };
  });
  return originPaths;
}
