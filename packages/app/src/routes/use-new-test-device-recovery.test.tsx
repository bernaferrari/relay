import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DeviceProductService } from "../data/device-product-service";
import { createRecordingSetupAdmission } from "../data/recording-setup-admission";
import { useNewTestDeviceRecovery } from "./use-new-test-device-recovery";

it("holds admission synchronously and ignores a late recovery for a replaced target", async () => {
  const admission = createRecordingSetupAdmission();
  const refetchTargets = vi.fn(async () => undefined);
  const onRecovered = vi.fn();
  const onError = vi.fn();
  let resolveRecovery!: (value: Awaited<ReturnType<DeviceProductService["recover"]>>) => void;
  const recover = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<DeviceProductService["recover"]>>>((resolve) => {
        resolveRecovery = resolve;
      }),
  );
  const service = { recover } as unknown as DeviceProductService;
  let controller!: ReturnType<typeof useNewTestDeviceRecovery>;
  function Probe({ targetId }: { targetId: string }) {
    controller = useNewTestDeviceRecovery({
      deviceService: service,
      targetId,
      admission,
      refetchTargets,
      onRecovered,
      onError,
    });
    return null;
  }
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function render(targetId: string) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe targetId={targetId} />
        </QueryClientProvider>,
      ),
    );
  }
  try {
    await render("ipad");
    await act(async () => {
      controller.mutate("ipad");
      controller.mutate("ipad");
      expect(admission.mayEdit()).toBe(false);
    });
    expect(recover).toHaveBeenCalledExactlyOnceWith("ipad", "connect");
    await render("other-device");
    await act(async () =>
      resolveRecovery({
        serial: "ipad",
        recovered: true,
        ready: true,
        summary: "Ready",
        actions: [],
        session: { status: "ready", detail: "Ready" },
      }),
    );
    expect(refetchTargets).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(admission.mayEdit()).toBe(true);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});
