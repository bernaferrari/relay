import { For, Show, createMemo, type Accessor } from "solid-js";
import type { BrowserDeviceSemanticOverlay as BrowserDeviceSemanticOverlayData } from "@relay/protocol";
import type { Frame } from "../lib/api-types";

/**
 * Paints server-derived semantic hints over Browser Device pixels. This
 * component has no DOM access to the product page and deliberately renders
 * inert spans rather than controls: inspection is not an implicit dispatch.
 */
export function BrowserDeviceSemanticOverlay(props: {
  overlay: Accessor<BrowserDeviceSemanticOverlayData | null | undefined>;
  frame: Accessor<Frame | null | undefined>;
  visible: Accessor<boolean>;
}) {
  const current = createMemo(() => {
    const overlay = props.overlay();
    const frame = props.frame();
    const binding = frame?.browserDevice;
    if (
      !props.visible() ||
      !overlay ||
      !frame ||
      !binding ||
      overlay.sessionId !== binding.sessionId ||
      overlay.pageId !== binding.pageId ||
      overlay.sequence !== binding.sequence ||
      (frame.visualFingerprint && overlay.visualFingerprint !== frame.visualFingerprint)
    ) {
      return null;
    }
    return { overlay, frame };
  });

  function styleFor(
    candidate: BrowserDeviceSemanticOverlayData["candidates"][number],
    frame: Frame,
  ): string {
    const width = frame.width ?? 0;
    const height = frame.height ?? 0;
    if (width <= 0 || height <= 0) return "display:none";
    return [
      `left:${(candidate.rect.x / width) * 100}%`,
      `top:${(candidate.rect.y / height) * 100}%`,
      `width:${(candidate.rect.width / width) * 100}%`,
      `height:${(candidate.rect.height / height) * 100}%`,
    ].join(";");
  }

  return (
    <Show when={current()}>
      {(bound) => (
        <div
          class="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
          data-browser-semantic-overlay
          aria-label={`Semantic labels for frame ${bound().overlay.sequence}`}
        >
          <For each={bound().overlay.candidates}>
            {(candidate) => (
              <span
                class="text-micro absolute overflow-hidden rounded border border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_15%,transparent)] px-1 py-0.5 font-medium leading-tight text-white shadow-sm"
                style={styleFor(candidate, bound().frame)}
                data-browser-semantic-candidate={candidate.id}
                title={candidate.reasoning}
                aria-label={`${candidate.role}${candidate.label ? ` · ${candidate.label}` : ""}`}
              >
                {candidate.label || candidate.value || candidate.role}
              </span>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
