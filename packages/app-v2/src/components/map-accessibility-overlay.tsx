import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  containedImageRect,
  type ImageDimensions,
  MAP_NODE_WIDTH,
  MAP_NODE_IMAGE_HEIGHT,
} from "./map-canvas-geometry";

type Control = {
  identifier?: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export function accessibilityControls(value: unknown, image: ImageDimensions): Control[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const bounds =
    root.bounds && typeof root.bounds === "object"
      ? (root.bounds as Record<string, unknown>)
      : undefined;
  const width = typeof bounds?.width === "number" ? bounds.width : image.width;
  const height = typeof bounds?.height === "number" ? bounds.height : image.height;
  if (!(width > 0 && height > 0)) return [];
  const controls: Control[] = [];
  const pending = Array.isArray(root.nodes)
    ? [...root.nodes]
    : Array.isArray(value)
      ? [...value]
      : [];
  for (let i = 0; i < pending.length && i < 2000; i++) {
    const item = pending[i];
    if (!item || typeof item !== "object") continue;
    const node = item as Record<string, unknown>;
    if (Array.isArray(node.children)) pending.push(...node.children);
    const rect = node.rect as Record<string, unknown> | undefined;
    const label = [node.label, node.identifier, node.value].find(
      (text) => typeof text === "string" && text.trim(),
    );
    if (
      !rect ||
      typeof label !== "string" ||
      node.visible === false ||
      node.visibleToUser === false
    )
      continue;
    const { x, y, width: w, height: h } = rect;
    if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const r = {
      x: (x as number) / width,
      y: (y as number) / height,
      width: (w as number) / width,
      height: (h as number) / height,
    };
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      r.x < 0 ||
      r.y < 0 ||
      r.x + r.width > 1.01 ||
      r.y + r.height > 1.01 ||
      r.width * r.height > 0.6
    )
      continue;
    controls.push({
      label,
      ...(typeof node.identifier === "string" ? { identifier: node.identifier } : {}),
      ...r,
    });
  }
  return controls;
}

export function MapAccessibilityOverlay({
  uri,
  load,
  image,
}: {
  uri?: string;
  load?: (uri: string) => Promise<unknown>;
  image?: ImageDimensions;
}) {
  const [hovered, setHovered] = useState<number>();
  const tree = useQuery({
    queryKey: ["map-accessibility", uri],
    queryFn: () => load!(uri!),
    enabled: Boolean(uri && load),
    staleTime: Infinity,
    retry: false,
  });
  const controls = image ? accessibilityControls(tree.data, image) : [];
  const rect = image
    ? containedImageRect(
        { x: 0, y: 0, width: MAP_NODE_WIDTH, height: MAP_NODE_IMAGE_HEIGHT },
        image,
        "top",
      )
    : undefined;
  if (!rect) return null;
  if (!controls.length)
    return (
      <span className="pointer-events-none absolute left-1/2 top-full mt-2 w-max max-w-full -translate-x-1/2 rounded bg-background/90 px-2 py-1 text-center text-xs text-muted-foreground">
        {!uri || !load
          ? "No saved accessibility tree"
          : tree.isPending
            ? "Loading controls…"
            : tree.isError
              ? "Couldn’t load accessibility tree"
              : "No control bounds retained"}
      </span>
    );
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${MAP_NODE_WIDTH} ${MAP_NODE_IMAGE_HEIGHT}`}
      aria-label="Saved accessibility controls"
    >
      {controls.map((control, index) => (
        <rect
          key={index}
          className="pointer-events-auto"
          x={rect.x + control.x * rect.width}
          y={rect.y + control.y * rect.height}
          width={control.width * rect.width}
          height={control.height * rect.height}
          rx="2"
          fill="var(--info)"
          fillOpacity={hovered === index ? 0.2 : 0.03}
          stroke="var(--info)"
          strokeOpacity={hovered === index ? 1 : 0.3}
          strokeWidth={hovered === index ? 1.5 : 0.75}
          vectorEffect="non-scaling-stroke"
          onPointerEnter={() => setHovered(index)}
          onPointerLeave={() => setHovered(undefined)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <title>{control.label}</title>
        </rect>
      ))}
    </svg>
  );
}
