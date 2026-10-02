/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestDevicePane } from "./test-device-pane";
import type { LiveTargetSession } from "../data/live-target-session";
import type { ComponentProps } from "react";
import type { DeviceLivePreview } from "./device-live-preview";
import { RecordingInputNotSentError } from "../data/recording-input-outcome";

const target = {
  kind: "device" as const,
  platform: "android" as const,
  targetId: "phone",
  name: "Pixel",
  detail: "Android",
};
const context = vi.hoisted(() => ({
  productService: { previewTarget: vi.fn(), inspectTargetHealth: vi.fn(), reconcileInput: vi.fn() },
  platform: { storage: { get: vi.fn(), set: vi.fn() } },
}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => context }));
vi.mock("./device-live-preview", () => ({
  DeviceLivePreview: (props: ComponentProps<typeof DeviceLivePreview>) => (
    <section>
      <canvas ref={props.canvas} />
      <button disabled={props.busy} onClick={() => void props.send({ kind: "key", key: "enter" })}>
        Send input
      </button>
      <button onClick={props.reconnect}>Reconnect</button>
      <p>{props.issue}</p>
    </section>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  context.platform.storage.get.mockImplementation(async (key: string) => saved.get(key) ?? null);
  context.platform.storage.set.mockImplementation(async (key: string, value: string) => {
    saved.set(key, value);
  });
  context.productService.inspectTargetHealth.mockResolvedValue({ input: { state: "ready" } });
  context.productService.reconcileInput.mockImplementation(async (input) => ({
    ...input,
    health: { state: "ready" },
  }));
});
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

async function renderInput(input: LiveTargetSession["input"]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const close = vi.fn();
  context.productService.previewTarget.mockImplementation(async (selected) => ({
    close,
    input,
    mount: () => () => {},
    snapshot: () => ({ status: "streaming", target: selected }),
    subscribe: () => () => {},
  }));
  await act(async () => root!.render(<TestDevicePane target={target} />));
  return { host, close };
}

it("persists unknown input and blocks both repeat and remount until canonical reconciliation", async () => {
  const input = vi.fn().mockRejectedValue(new Error("Input acknowledgement lost"));
  const { host } = await renderInput(input);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(input).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Input outcome unknown");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(saved.size).toBe(1);
  await act(async () => root!.unmount());
  const remounted = await renderInput(input);
  expect(remounted.host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  const applied = [...remounted.host.querySelectorAll("button")].find(
    (button) => button.textContent === "It applied",
  )!;
  await act(async () => applied.click());
  expect(context.productService.reconcileInput).toHaveBeenCalledWith(
    expect.objectContaining({ serial: "phone", outcome: "applied", reconcilePending: true }),
  );
  expect(remounted.host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect(input).toHaveBeenCalledOnce();
});

it("does not attribute a late input failure to a replacement target", async () => {
  let reject!: (error: Error) => void;
  const input = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const { host, close } = await renderInput(input);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () =>
    root!.render(
      <TestDevicePane target={{ ...target, targetId: "other-phone", name: "Other phone" }} />,
    ),
  );
  await act(async () => reject(new Error("Late acknowledgement loss")));
  expect(close).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Input outcome unknown");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect([...saved.keys()]).toEqual(["live-input-ledger:android:phone"]);
});

it("keeps a known preflight refusal retryable without marking it unknown", async () => {
  const input = vi.fn().mockRejectedValue(new RecordingInputNotSentError("Preview is not ready"));
  const { host } = await renderInput(input);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("Input was not sent");
  expect(host.textContent).not.toContain("It applied");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  expect(saved.size).toBe(0);
  expect(input).toHaveBeenCalledOnce();
});

it("checks server-owned uncertainty before enabling input even without a stored projection", async () => {
  context.productService.inspectTargetHealth.mockResolvedValue({
    input: {
      state: "uncertain",
      pendingMutationId: "ios-input-pending",
      reason: "lost acknowledgement",
    },
  });
  const input = vi.fn();
  const { host } = await renderInput(input);
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(host.textContent).toContain("It applied");
  expect(input).not.toHaveBeenCalled();
});
