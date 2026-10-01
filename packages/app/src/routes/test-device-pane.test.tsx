/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TestDevicePane } from "./test-device-pane";
import type { LiveTargetSession } from "../data/live-target-session";

const target = {
  kind: "device" as const,
  platform: "android" as const,
  targetId: "phone",
  name: "Pixel",
  detail: "Android",
};
const context = vi.hoisted(() => ({
  productService: { previewTarget: vi.fn() },
  platform: { storage: { get: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => context }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it("opens the selected physical device and closes a pending preview when its view is left", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let resolve!: (session: LiveTargetSession) => void;
  context.productService.previewTarget.mockReturnValue(
    new Promise<LiveTargetSession>((done) => {
      resolve = done;
    }),
  );
  await act(async () => root!.render(<TestDevicePane target={target} />));
  expect(context.productService.previewTarget).toHaveBeenCalledWith(target);
  expect(host.textContent).not.toContain("Open website");
  await act(async () => root!.unmount());
  root = undefined;
  const close = vi.fn();
  const mount = vi.fn();
  await act(async () => {
    resolve({ close, mount } as unknown as LiveTargetSession);
  });
  expect(close).toHaveBeenCalledOnce();
  expect(mount).not.toHaveBeenCalled();
});
