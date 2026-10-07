import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RecordingProductService } from "../data/recording-product-service";
import { initialSetupMode, useNewTestTargets } from "./use-new-test-setup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("contextual website setup", () => {
  it("opens the address form for a known website app", () => {
    expect(
      initialSetupMode({
        app: { id: "shop", name: "Shop", platform: "web" },
        requestedAppId: "shop",
        startsFromPath: false,
      }),
    ).toBe("website");
  });
  it("preserves explicit target and map path precedence", () => {
    const context = {
      app: { id: "shop", name: "Shop", platform: "web" as const },
      requestedAppId: "shop",
      startsFromPath: false,
    };
    expect(initialSetupMode({ ...context, requestedTargetId: "browser" })).toBe("detailed");
    expect(initialSetupMode({ ...context, startsFromPath: true })).toBe("detailed");
  });
  it("keeps mobile and unknown app setup explicit", () => {
    for (const platform of ["android", "ios", undefined] as const) {
      expect(
        initialSetupMode({
          app: { id: "app", name: "App", platform },
          requestedAppId: "app",
          startsFromPath: false,
        }),
      ).toBe("detailed");
    }
  });
});

it("rediscovers a requested managed browser after generic non-retryable recovery", async () => {
  const browser = { kind: "browser", platform: "browser", targetId: "managed-browser" } as const;
  const connect = vi
    .fn<RecordingProductService["connect"]>()
    .mockResolvedValueOnce({
      status: "idle",
      targets: [],
      recovery: {
        code: "transport",
        title: "Something went wrong",
        detail: "Relay could not complete this action.",
        recovery: "Try again.",
        retryable: false,
      },
    })
    .mockResolvedValue({ status: "target-selection", targets: [browser], selectedTarget: browser });
  const presentTargets = vi.fn<RecordingProductService["presentTargets"]>(async (targets) =>
    targets.map((target) => ({ ...target, name: "Managed browser", detail: "Managed browser" })),
  );
  const service = { connect, presentTargets } as unknown as RecordingProductService;
  let discovery!: ReturnType<typeof useNewTestTargets>;
  function Probe() {
    discovery = useNewTestTargets({
      service,
      enabled: true,
      targetKind: "browser",
      requestedTargetId: browser.targetId,
      selectedTargetId: browser.targetId,
    });
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.useFakeTimers();
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(discovery.data?.recovery?.retryable).toBe(false);
    expect(discovery.data?.targetOptions).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(connect).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenLastCalledWith({ targetKind: "browser", targetId: browser.targetId });
    expect(discovery.data?.selectedTarget).toEqual(browser);
    expect(discovery.data?.targetOptions).toEqual([
      { ...browser, name: "Managed browser", detail: "Managed browser" },
    ]);
    expect(discovery.data?.recovery).toBeUndefined();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(connect).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.useRealTimers();
  }
});
