import { useEffect, useState } from "react";
import {
  LANDSCAPE_NODE,
  PORTRAIT_NODE,
  mapNodeSizeFor,
  type ImageDimensions,
  type MapNodeSize,
} from "./map-canvas-geometry";

/** Wide screenshots (tablets, browsers) get wide nodes. Remember the shape per
 * App so the layout does not jump while screenshots load on the next visit. */
export function useMapNodeSize(appId: string, images: ReadonlyMap<string, ImageDimensions>) {
  const key = `relay:map-node-shape:${appId}`;
  const [remembered] = useState<MapNodeSize | undefined>(() => {
    try {
      const value = localStorage.getItem(key);
      return value === "landscape"
        ? LANDSCAPE_NODE
        : value === "portrait"
          ? PORTRAIT_NODE
          : undefined;
    } catch {
      return undefined;
    }
  });
  const measured = images.size ? mapNodeSizeFor(images.values()) : undefined;
  useEffect(() => {
    if (!measured) return;
    try {
      localStorage.setItem(key, measured === LANDSCAPE_NODE ? "landscape" : "portrait");
    } catch {
      // Storage is a convenience; the measured shape still applies.
    }
  }, [key, measured]);
  return measured ?? remembered ?? PORTRAIT_NODE;
}
