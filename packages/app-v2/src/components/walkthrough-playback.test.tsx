import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WalkthroughPlayback } from "./walkthrough-playback";
import type { PlayerManifestProjection } from "../data/run-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("plays only recorded, valid controls and navigates without device input", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const navigate = vi.fn();
  const capture = {
    id: "image",
    stateId: "settings",
    variantId: "member",
    runId: "run",
    framePath: "frame.png",
    imageSha256: "hash",
    caption: "Settings",
    capturedAt: 1,
  };
  const recorded = {
    id: "open",
    fromStateId: "settings",
    toStateId: "language",
    kind: "recorded" as const,
    label: "Language",
    provenance: { runId: "run", captureId: "exact-language" },
    hotspot: {
      connectionId: "open",
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      point: { x: 0.9, y: 0.9 },
      actions: [],
    },
  };
  const connections: PlayerManifestProjection["connections"] = [
    recorded,
    { ...recorded, id: "planned", kind: "authored" },
    { ...recorded, id: "other-run", provenance: { runId: "other" } },
    {
      ...recorded,
      id: "invalid",
      hotspot: { ...recorded.hotspot, rect: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } },
    },
  ];
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <WalkthroughPlayback
            capture={capture}
            src="/saved.png"
            title="Settings"
            connections={connections}
            entryStateId="home"
            onNavigate={navigate}
            onError={() => {}}
          />
        </QueryClientProvider>,
      ),
    );
    const hotspots = host.querySelectorAll<HTMLButtonElement>('[data-recorded="true"]');
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].style.getPropertyValue("--hotspot-left")).toBe("10%");
    await act(async () => hotspots[0].click());
    expect(navigate).toHaveBeenLastCalledWith("language", "exact-language");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-pressed]")!.click());
    expect(host.querySelector("[aria-pressed]")?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelectorAll('[data-recorded="true"]')).toHaveLength(1);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Return to start screen"]')!.click(),
    );
    expect(navigate).toHaveBeenLastCalledWith("home");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
