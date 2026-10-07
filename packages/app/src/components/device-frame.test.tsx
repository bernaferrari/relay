/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { DeviceFrame, shapeForSize, type DeviceShape } from "./device-frame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it.each(["ios", "android"] as const)(
  "classifies %s phone and tablet pixels in either orientation without browser chrome",
  (platform) => {
    expect(shapeForSize(2224, 1668, platform)).toBe("tablet");
    expect(shapeForSize(1668, 2224, platform)).toBe("tablet");
    expect(shapeForSize(1920, 1080, platform)).toBe("phone");
    expect(shapeForSize(1080, 1920, platform)).toBe("phone");
    for (const [width, height] of [
      [0, 0],
      [0, 834],
      [NaN, 834],
      [1112, Infinity],
    ]) {
      expect(shapeForSize(width, height, platform)).toBe("phone");
    }
  },
);

it("retains generic landscape browser framing", () => {
  expect(shapeForSize(2224, 1668)).toBe("window");
  expect(shapeForSize(1440, 900)).toBe("window");
  expect(shapeForSize(1668, 2224)).toBe("tablet");
  expect(shapeForSize(1080, 1920)).toBe("phone");
});

it("keeps its screen content mounted when device or browser framing changes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = async (shape: DeviceShape) => {
    await act(async () =>
      root!.render(
        <DeviceFrame alt="Preview" shape={shape} placeholder={<canvas aria-label="Preview" />} />,
      ),
    );
  };
  await render("phone");
  const canvas = host.querySelector("canvas")!;
  canvas.width = 2224;
  canvas.height = 1668;
  for (const shape of ["tablet", "window", "phone"] as const) {
    await render(shape);
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(canvas.isConnected).toBe(true);
    expect(canvas.width).toBe(2224);
    expect(canvas.height).toBe(1668);
    expect(canvas.closest("figure")?.dataset.shape).toBe(shape);
  }
});

it("uses the native platform for loaded screenshot framing without replacing the image", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<DeviceFrame alt="Tablet" src="/tablet.png" />));
  const image = host.querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { value: 2224 },
    naturalHeight: { value: 1668 },
  });
  await act(async () => image.dispatchEvent(new Event("load")));
  expect(image.closest("figure")?.dataset.shape).toBe("window");
  await act(async () =>
    root!.render(<DeviceFrame alt="Tablet" src="/tablet.png" platform="ios" />),
  );
  expect(host.querySelector("img")).toBe(image);
  expect(image.closest("figure")?.dataset.shape).toBe("tablet");
});
