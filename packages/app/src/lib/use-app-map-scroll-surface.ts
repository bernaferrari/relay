import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import type { AppMap } from "@relay/protocol";
import { useServer } from "../context/server";
import { latestScreenVariant } from "./app-map-workspace-helpers";

/** Screen-inspector state for selecting, capturing, and reopening one exact
 * target/locale Screen Variant. This deliberately does not use recording or a
 * renderer-owned frame timeline. */
export function useAppMapScrollSurface(input: {
  activeAppMap: Accessor<AppMap | undefined>;
  screenId: Accessor<string | undefined>;
}) {
  const server = useServer();
  const [busy, setBusy] = createSignal(false);
  const [regenerating, setRegenerating] = createSignal(false);
  const [error, setError] = createSignal("");
  const [selectedVariantId, setSelectedVariantId] = createSignal("");
  let previousScreenId: string | undefined;
  createEffect(() => {
    const screenId = input.screenId();
    if (screenId === previousScreenId) return;
    previousScreenId = screenId;
    setSelectedVariantId("");
    setError("");
  });

  const variant = createMemo(() => {
    const map = input.activeAppMap();
    const screenId = input.screenId();
    const screen = screenId ? map?.screens[screenId] : undefined;
    if (!map || !screen) return undefined;
    const variants = screen.variantIds
      .flatMap((id) => (map.screenVariants[id] ? [map.screenVariants[id]!] : []))
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
    return (
      variants.find((candidate) => candidate.id === selectedVariantId()) ??
      variants.find((candidate) => candidate.targetProfile.targetId === server.selectedDevice()) ??
      latestScreenVariant(map, screen.id)
    );
  });
  const surface = createMemo(
    () =>
      variant()?.scrollSurfaces?.toSorted(
        (left, right) =>
          right.capturedAt - left.capturedAt || right.captureId.localeCompare(left.captureId),
      )[0],
  );
  const variants = createMemo(() => {
    const map = input.activeAppMap();
    const screenId = input.screenId();
    const screen = screenId ? map?.screens[screenId] : undefined;
    if (!map || !screen) return [];
    return screen.variantIds.flatMap((id) => {
      const candidate = map.screenVariants[id];
      return candidate
        ? [
            {
              id: candidate.id,
              label: `${candidate.targetProfile.name} · ${candidate.targetProfile.id}`,
            },
          ]
        : [];
    });
  });
  const disabledReason = createMemo(() => {
    const selected = variant();
    if (!selected) return "Save a normal screen capture before collecting its full page.";
    if (selected.targetProfile.platform === "browser") {
      return "Native full-page capture is available for Android and iOS variants.";
    }
    const serial = server.selectedDevice();
    if (!serial || !server.selectedLeaseId()) return "Connect and reserve this variant’s device.";
    if (serial !== selected.targetProfile.targetId) {
      return `Select ${selected.targetProfile.name} to capture this variant.`;
    }
    return undefined;
  });

  const capture = async () => {
    const map = input.activeAppMap();
    const screenId = input.screenId();
    const selected = variant();
    const leaseId = server.selectedLeaseId();
    if (
      !map ||
      !screenId ||
      !selected ||
      !leaseId ||
      (selected.targetProfile.platform !== "android" &&
        selected.targetProfile.platform !== "ios") ||
      disabledReason()
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await server.runAction("app-map.scroll-surface.capture", {
        appMapId: map.id,
        screenId,
        variantId: selected.id,
        expectedRevision: map.revision,
        target: {
          kind: "device",
          platform: selected.targetProfile.platform,
          targetId: selected.targetProfile.targetId,
        },
        leaseId,
        maxScrolls: 6,
      });
      await server.refreshAppMaps();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const map = input.activeAppMap();
    const screenId = input.screenId();
    const selected = variant();
    const currentSurface = surface();
    if (!map || !screenId || !selected || !currentSurface) return;
    setRegenerating(true);
    setError("");
    try {
      await server.runAction("app-map.scroll-surface.regenerate", {
        appMapId: map.id,
        screenId,
        variantId: selected.id,
        captureId: currentSurface.captureId,
        expectedRevision: map.revision,
      });
      await server.refreshAppMaps();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRegenerating(false);
    }
  };

  return {
    variant,
    surface,
    evidenceUrl: (uri: string, mime: "image/png" | "application/json") =>
      server.authoringEvidenceUrl(uri, mime),
    regenerateProps: createMemo(() => ({
      busy: regenerating(),
      onRegenerate: () => void regenerate(),
    })),
    captureProps: createMemo(() => ({
      busy: busy(),
      disabledReason: disabledReason(),
      error: error() || undefined,
      variants: variants(),
      selectedVariantId: variant()?.id,
      policy: variant()?.scrollCapturePolicy,
      onSelectVariant: (variantId: string) => {
        setSelectedVariantId(variantId);
        setError("");
      },
      onCapture: () => void capture(),
    })),
  };
}
