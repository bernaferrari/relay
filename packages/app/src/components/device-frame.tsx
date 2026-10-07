/** @jsxImportSource react */
import { useState, type ReactNode } from "react";

export type DeviceShape = "phone" | "tablet" | "window";

/** Native device shape is independent of orientation; generic landscape uses browser framing. */
export function shapeForSize(
  width: number,
  height: number,
  platform?: "ios" | "android",
): DeviceShape {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return "phone";
  if (platform) return Math.max(width, height) / Math.min(width, height) < 1.5 ? "tablet" : "phone";
  if (width > height * 1.15) return "window";
  if (height / width < 1.5) return "tablet";
  return "phone";
}

/**
 * Every screenshot in Relay sits in a device: a phone with a bezel and island,
 * a tablet, or a browser window. The shape follows the image unless given.
 */
export function DeviceFrame({
  src,
  alt,
  shape: requested,
  platform,
  size = "lg",
  placeholder,
  children,
  className = "",
}: {
  src?: string;
  alt: string;
  shape?: DeviceShape;
  /** Native frames stay devices in either orientation; Android pixels include the status area. */
  platform?: "ios" | "android";
  size?: "sm" | "md" | "lg";
  placeholder?: ReactNode;
  /** Overlays drawn on top of the screen (ignore areas, change boxes). */
  children?: ReactNode;
  className?: string;
}) {
  const [measured, setMeasured] = useState<{ width: number; height: number }>();
  const shape =
    requested ?? (measured ? shapeForSize(measured.width, measured.height, platform) : "phone");
  const screen = src ? (
    <div data-slot="device-frame-content" className="relative">
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="block h-auto w-full select-none"
        onLoad={(event) =>
          setMeasured({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
      {children}
    </div>
  ) : (
    <div
      data-slot="device-frame-content"
      className="flex aspect-9/19 items-center justify-center bg-card px-6 text-center text-sm text-muted-foreground"
    >
      {placeholder ?? "No screen yet"}
    </div>
  );
  const width =
    shape === "window"
      ? size === "sm"
        ? "w-16"
        : size === "md"
          ? "w-full max-w-md"
          : "w-full max-w-4xl"
      : shape === "tablet"
        ? size === "sm"
          ? "w-28"
          : size === "md"
            ? "w-72"
            : "w-full max-w-lg"
        : size === "sm"
          ? "w-16"
          : size === "md"
            ? "w-56"
            : "w-full max-w-72";
  const bezel =
    size === "sm"
      ? "border-3 rounded-lg"
      : size === "md"
        ? "border-6 rounded-3xl"
        : "border-10 rounded-4xl";
  return (
    <figure
      data-slot="evidence-image-frame"
      data-shape={shape}
      className={`relative overflow-hidden shadow-xl ${shape === "window" ? "rounded-xl border border-border bg-card" : `border-bezel bg-bezel ${bezel}`} ${width} ${className}`}
    >
      {shape === "window" ? (
        <div
          key="chrome"
          data-slot="device-frame-window-chrome"
          className={`flex items-center gap-1.5 border-b border-border bg-muted/60 ${size === "sm" ? "h-3 px-1.5" : "h-7 px-3"}`}
          aria-hidden="true"
        >
          {size === "sm" ? null : (
            <>
              <span className="size-2.5 rounded-full bg-destructive/70" />
              <span className="size-2.5 rounded-full bg-warning/80" />
              <span className="size-2.5 rounded-full bg-success/80" />
            </>
          )}
        </div>
      ) : null}
      {shape === "phone" && size !== "sm" && platform !== "android" ? (
        <span
          key="island"
          aria-hidden="true"
          className={`absolute top-1.5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-bezel ${size === "md" ? "h-3.5 w-14" : "h-5 w-20"}`}
        />
      ) : null}
      <div
        key="screen"
        data-slot="device-frame-screen"
        className={`overflow-hidden bg-card ${shape === "window" ? "" : size === "sm" ? "rounded-md" : "rounded-2xl"}`}
      >
        {screen}
      </div>
    </figure>
  );
}
