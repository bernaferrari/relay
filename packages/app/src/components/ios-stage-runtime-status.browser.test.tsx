import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import { iosLiveSemanticPlane } from "../lib/ios-live-semantic-plane";
import {
  IosStageRuntimeStatus,
  iosStageRuntimeStatus,
  type IosStageRuntimeAction,
} from "./ios-stage-runtime-status";

function mount(status: ReturnType<typeof iosStageRuntimeStatus>) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onAction = vi.fn<(action: IosStageRuntimeAction) => void>();
  const dispose = render(() => <IosStageRuntimeStatus status={status} onAction={onAction} />, root);
  return { root, onAction, dispose };
}

test("iPad runtime rail keeps pixels, label proof, and exclusive input independently visible", () => {
  const status = iosStageRuntimeStatus({
    pixelsAvailable: true,
    semanticPlane: iosLiveSemanticPlane({
      readiness: {
        mode: "accessibility",
        state: "unavailable",
        freshness: "unproven",
      },
    }),
    controlActive: false,
    controlIssue: "Another Relay window has exclusive access to this iPad.",
    canTakeControl: true,
    inspectionHint: {
      title: "Labels unavailable",
      detail: "The picture is still usable. Reconnect once after Automation is running.",
      actionLabel: "Reconnect",
      action: "reconnect",
    },
  });
  const view = mount(status);

  expect(view.root.querySelector("[data-ios-stage-runtime-status]")).not.toBeNull();
  expect(view.root.querySelector("[data-ios-stage-plane='pixels']")?.textContent).toContain(
    "PreviewVisible",
  );
  expect(view.root.querySelector("[data-ios-stage-plane='labels']")?.textContent).toContain(
    "LabelsUnavailable",
  );
  expect(view.root.querySelector("[data-ios-stage-plane='input']")?.textContent).toContain(
    "InputView only",
  );

  const action = view.root.querySelector<HTMLButtonElement>("[data-ios-stage-action]")!;
  expect(action.textContent).toContain("Take control");
  expect(action.getAttribute("data-ios-stage-action")).toBe("take-control");
  expect(action.getAttribute("aria-label")).toContain("Another Relay window has exclusive access");
  action.click();
  expect(view.onAction).toHaveBeenCalledOnce();
  expect(view.onAction).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "take-control", source: "control" }),
  );
  view.dispose();
});

test("an in-flight iOS label read remains a calm non-actionable state", () => {
  const status = iosStageRuntimeStatus({
    pixelsAvailable: true,
    semanticPlane: iosLiveSemanticPlane({
      readiness: {
        mode: "accessibility",
        state: "unavailable",
        freshness: "unproven",
        reason: "probe-in-flight",
      },
    }),
    controlActive: true,
    canTakeControl: false,
    inspectionHint: {
      title: "Accessibility is still reading",
      detail: "The picture is still live. Wait for the current names read to settle.",
    },
  });
  const view = mount(status);

  const labels = view.root.querySelector<HTMLElement>("[data-ios-stage-plane='labels']")!;
  expect(labels.textContent).toContain("LabelsReading");
  expect(labels.getAttribute("data-ios-stage-plane-tone")).toBe("progress");
  expect(view.root.querySelector("[data-ios-stage-action]")).toBeNull();
  view.dispose();
});

test("unconfirmed iPad input stays non-actionable until Relay reports a real blocker", () => {
  const status = iosStageRuntimeStatus({
    pixelsAvailable: true,
    semanticPlane: iosLiveSemanticPlane({
      readiness: {
        mode: "accessibility",
        state: "proven",
        freshness: "current",
        proof: { at: Date.now() },
      },
    }),
    controlActive: false,
    canTakeControl: false,
  });
  const view = mount(status);

  const input = view.root.querySelector<HTMLElement>("[data-ios-stage-plane='input']")!;
  expect(input.textContent).toContain("InputNot confirmed");
  expect(view.root.querySelector("[data-ios-stage-action]")).toBeNull();
  view.dispose();
});
