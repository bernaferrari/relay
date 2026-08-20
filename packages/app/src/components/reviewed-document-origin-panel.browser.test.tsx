import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type {
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginInspection,
  ScreenVariant,
  TargetProfile,
} from "@relay/protocol";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "@relay/protocol";
import {
  ReviewedDocumentOriginPanel,
  type ReviewedDocumentOriginPanelProps,
} from "./reviewed-document-origin-panel";

type ReviewHandler = ReviewedDocumentOriginPanelProps["onReview"];
type RevokeHandler = ReviewedDocumentOriginPanelProps["onRevoke"];

const profile: TargetProfile = {
  id: "pixel-settings-en",
  targetId: "pixel-1",
  source: "device",
  platform: "android",
  name: "Pixel settings · English",
  capabilities: ["scroll", "snapshot", "screenshot"],
  observedAt: 1,
};

const appMap = {
  schemaVersion: 1,
  id: "settings-map",
  organizationId: "org",
  projectId: "project",
  name: "Settings",
  revision: 7,
} as AppMap;

const variant = {
  id: "settings-en",
  appMapId: appMap.id,
  screenId: "settings",
  targetProfile: profile,
} as ScreenVariant;

function evidence(id: string, mime: "image/png" | "application/json") {
  return {
    id: `evidence-${id}`,
    uri: `relay-evidence://${id.padEnd(64, "a").slice(0, 64)}`,
    sha256: id.padEnd(64, "a").slice(0, 64),
    mime,
    bytes: 128,
  };
}

const surface = {
  schemaVersion: 1,
  id: "settings-surface",
  captureId: "capture-1",
  targetProfileId: profile.id,
  capturePolicy: {
    captureMode: "full-surface",
    source: "explicit",
    reason: "Stable Settings document",
    decidedAt: 1,
  },
  capturedAt: 2,
  status: "completed",
  reason: "end-of-content",
  message: "Captured",
  restoredStartViewport: true,
  viewports: [
    {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: 2,
      width: 1080,
      height: 2400,
      screenshot: { ...evidence("first-png", "image/png"), mime: "image/png" as const },
      accessibilityTree: {
        ...evidence("first-tree", "application/json"),
        mime: "application/json" as const,
      },
    },
  ],
  mergedTree: {
    ...evidence("merged-tree", "application/json"),
    mime: "application/json" as const,
    nodeCount: 12,
  },
  manifest: { ...evidence("manifest", "application/json"), mime: "application/json" as const },
} as LogicalScrollSurface;

function inspection(status: "active" | "invalid" | "revoked"): ReviewedDocumentOriginInspection {
  const active = status !== "revoked";
  const ledger = {
    schemaVersion: 1,
    projectionId: "reviewed-origin-1",
    sequence: status === "revoked" ? 3 : 2,
    status: active ? "active" : "revoked",
    createdAt: 3,
    activatedAt: 4,
    authorization: {
      schemaVersion: 1,
      issuer: "relay-local-reviewed-origin-ledger",
      signature: "ledger",
    },
  };
  const revocation =
    status === "revoked"
      ? {
          ...ledger,
          revocation: {
            actor: { actorId: "human:reviewer", actorKind: "human" },
            reason: "The captured document top was superseded.",
            assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
            confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
            at: 5,
            evidence: {
              ...evidence("revoke-record", "application/json"),
              mime: "application/json" as const,
            },
          },
        }
      : undefined;
  return {
    appMapId: appMap.id,
    screenId: "settings",
    variantId: variant.id,
    captureId: surface.captureId,
    lineage: [
      {
        projection: {
          schemaVersion: 1,
          id: "reviewed-origin-1",
          binding: {
            schemaVersion: 1,
            organizationId: appMap.organizationId,
            projectId: appMap.projectId,
            appMapId: appMap.id,
            appMapRevision: appMap.revision,
            appMapDigest: "digest",
            mapEpoch: "epoch",
            screenId: "settings",
            variantId: variant.id,
            surfaceId: surface.id,
            captureId: surface.captureId,
            targetProfileId: profile.id,
            platform: "android",
            firstViewport: {
              index: 0,
              offsetY: 0,
              appendedHeight: 0,
              capturedAt: 2,
              width: 1080,
              height: 2400,
              screenshot: { ...evidence("first-png", "image/png"), mime: "image/png" as const },
              accessibilityTree: {
                ...evidence("first-tree", "application/json"),
                mime: "application/json" as const,
              },
            },
          },
          approval: {
            actor: { actorId: "human:reviewer", actorKind: "human" },
            reason: "The first saved viewport is the visible Settings document top.",
            assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
            confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
            at: 4,
            evidence: {
              ...evidence("review-record", "application/json"),
              mime: "application/json" as const,
            },
          },
          authorization: {
            schemaVersion: 1,
            issuer: "relay-local-reviewed-origin",
            signature: "projection",
          },
        },
        ledger,
        ledgerEvents: [ledger],
        ...(revocation ? { revocationTombstone: revocation } : {}),
        currentBinding: status !== "invalid",
      },
    ],
  } as unknown as ReviewedDocumentOriginInspection;
}

function mount(input: {
  inspection?: ReviewedDocumentOriginInspection;
  onReview?: ReviewHandler;
  onRevoke?: RevokeHandler;
}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onReview: ReviewHandler = input.onReview ?? (async () => undefined);
  const onRevoke: RevokeHandler = input.onRevoke ?? (async () => undefined);
  const dispose = render(
    () => (
      <ReviewedDocumentOriginPanel
        appMap={appMap}
        screenId="settings"
        variant={variant}
        surface={surface}
        inspection={input.inspection}
        evidenceUrl={(uri, mime) => `/evidence/${uri.slice(-8)}?mime=${mime}`}
        onInspect={() => undefined}
        onReview={onReview}
        onRevoke={onRevoke}
      />
    ),
    root,
  );
  return { root, dispose, onReview, onRevoke };
}

function setText(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

test("shows the active origin binding and immutable first PNG/tree before authority controls", () => {
  const view = mount({ inspection: inspection("active") });
  expect(view.root.querySelector("[data-reviewed-origin-evidence] img")).not.toBeNull();
  expect(view.root.querySelector("[data-reviewed-origin-binding]")?.textContent).toContain(
    "settings-en",
  );
  expect(view.root.querySelector("[data-reviewed-origin-status='active']")?.textContent).toContain(
    "Active",
  );
  expect(view.root.textContent).toContain("Open first accessibility tree");
  expect(view.root.querySelector("[data-reviewed-origin-start-revoke]")).not.toBeNull();
  expect(view.root.querySelector("[data-reviewed-origin-start-review]")).toBeNull();
  view.dispose();
  document.body.replaceChildren();
});

test("keeps invalid and revoked lineages visible instead of silently treating them as active", () => {
  const invalid = mount({ inspection: inspection("invalid") });
  expect(
    invalid.root.querySelector("[data-reviewed-origin-lineage-status='invalid']"),
  ).not.toBeNull();
  expect(invalid.root.textContent).toContain("cannot authorize a restore");
  expect(invalid.root.querySelector("[data-reviewed-origin-start-revoke]")).not.toBeNull();
  invalid.dispose();
  document.body.replaceChildren();

  const revoked = mount({ inspection: inspection("revoked") });
  expect(
    revoked.root.querySelector("[data-reviewed-origin-lineage-status='revoked']"),
  ).not.toBeNull();
  expect(revoked.root.textContent).toContain("Revocation record");
  expect(revoked.root.querySelector("[data-reviewed-origin-start-revoke]")).toBeNull();
  revoked.dispose();
  document.body.replaceChildren();
});

test("requires a reason and visible confirmation before sending the exact review authority payload", async () => {
  const onReview = vi.fn<ReviewHandler>(async () => undefined);
  const view = mount({ onReview });
  view.root.querySelector<HTMLButtonElement>("[data-reviewed-origin-start-review]")?.click();
  const form = view.root.querySelector<HTMLFormElement>("[data-reviewed-origin-review-form]")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
  expect(submit.disabled).toBe(true);
  setText(
    form.querySelector("textarea")!,
    "The first raw PNG/tree pair is visibly at the document top.",
  );
  expect(submit.disabled).toBe(true);
  form.querySelector<HTMLInputElement>("input[type='checkbox']")?.click();
  expect(submit.disabled).toBe(false);
  submit.click();
  await Promise.resolve();
  expect(onReview).toHaveBeenCalledWith({
    reason: "The first raw PNG/tree pair is visibly at the document top.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  });
  view.dispose();
  document.body.replaceChildren();
});

test("requires a reason and visible confirmation before sending the exact revocation payload", async () => {
  const onRevoke = vi.fn<RevokeHandler>(async () => undefined);
  const view = mount({ inspection: inspection("active"), onRevoke });
  view.root.querySelector<HTMLButtonElement>("[data-reviewed-origin-start-revoke]")?.click();
  const form = view.root.querySelector<HTMLFormElement>("[data-reviewed-origin-revoke-form]")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
  expect(submit.disabled).toBe(true);
  setText(
    form.querySelector("textarea")!,
    "The page has changed and this origin must not authorize restore.",
  );
  form.querySelector<HTMLInputElement>("input[type='checkbox']")?.click();
  submit.click();
  await Promise.resolve();
  expect(onRevoke).toHaveBeenCalledWith("reviewed-origin-1", {
    reason: "The page has changed and this origin must not authorize restore.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
    confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  });
  view.dispose();
  document.body.replaceChildren();
});

test("keeps evidence and approval controls usable at the narrow inspector width", () => {
  const view = mount({});
  const panel = view.root.querySelector<HTMLElement>("[data-reviewed-origin-panel]")!;
  expect(panel.dataset.narrowLayout).toBe("stack");
  expect(panel.className).toContain("gap-3");
  expect(
    view.root.querySelector("[data-reviewed-origin-evidence] .grid-cols-2")?.className,
  ).toContain("max-[380px]:grid-cols-1");
  view.root.querySelector<HTMLButtonElement>("[data-reviewed-origin-start-review]")?.click();
  const textarea = view.root.querySelector<HTMLTextAreaElement>(
    "[data-reviewed-origin-review-form] textarea",
  )!;
  expect(textarea.className).toContain("text-title");
  expect(textarea.className).toContain("min-h-22");
  for (const control of view.root.querySelectorAll<HTMLButtonElement>("button")) {
    expect(control.className).toContain("min-h-11");
  }
  view.dispose();
  document.body.replaceChildren();
});
