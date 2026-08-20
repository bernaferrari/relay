import { Show, createMemo } from "solid-js";
import type { AppMap, LogicalScrollSurface, ScreenVariant } from "@relay/protocol";
import { useServer } from "../context/server";
import type { ReviewedDocumentOriginTransport } from "../lib/reviewed-document-origin-controller";
import { useReviewedDocumentOrigin } from "../lib/use-reviewed-document-origin";
import { ReviewedDocumentOriginPanel } from "./reviewed-document-origin-panel";

/** Connects the evidence-only panel to the three canonical reviewed-origin
 * operations. There is intentionally no target, lease, capture, or generic
 * HTTP capability in this boundary. */
export function ReviewedDocumentOriginControl(props: {
  appMap: AppMap;
  screenId: string;
  variant: ScreenVariant;
  surface: LogicalScrollSurface;
  evidenceUrl: (uri: string, mime: "image/png" | "application/json") => string;
}) {
  const server = useServer();
  const selection = createMemo(() => {
    if (props.variant.targetProfile.platform !== "android") return undefined;
    return {
      appMapId: props.appMap.id,
      screenId: props.screenId,
      variantId: props.variant.id,
      captureId: props.surface.captureId,
      expectedRevision: props.appMap.revision,
    };
  });
  const origin = useReviewedDocumentOrigin({
    selection,
    transport: { runAction: server.runAction } as ReviewedDocumentOriginTransport,
  });

  return (
    <Show when={selection()}>
      <ReviewedDocumentOriginPanel
        appMap={props.appMap}
        screenId={props.screenId}
        variant={props.variant}
        surface={props.surface}
        inspection={origin.inspection()}
        inspectionBusy={origin.inspectionBusy()}
        actionState={origin.actionState()}
        error={origin.error() || undefined}
        evidenceUrl={props.evidenceUrl}
        onInspect={async () => {
          await origin.inspect().catch(() => undefined);
        }}
        onReview={origin.review}
        onRevoke={origin.revoke}
      />
    </Show>
  );
}
