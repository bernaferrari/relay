import { describe, expect, it } from "vitest";
import { snapshotConditionSuggestions } from "./recording-condition-suggestions";

describe("recording condition suggestions", () => {
  it("keeps foreground app results when notifications and a keyboard precede them", () => {
    const nodes = [
      ...Array.from({ length: 25 }, (_, index) => ({
        bundleId: "com.android.systemui",
        label: `Notification ${index}`,
      })),
      { bundleId: "keyboard.app", label: "Return" },
      { bundleId: "ai.x.grok", label: "Copy message" },
      { bundleId: "ai.x.grok", label: "Download" },
      { bundleId: "ai.x.grok", label: "Private hidden result", visibleToUser: false },
    ];
    expect(snapshotConditionSuggestions({ foregroundApp: "ai.x.grok", nodes })).toEqual([
      "Copy message",
      "Download",
    ]);
  });

  it("uses the current foreground during an app handoff and retains unlabeled web ownership", () => {
    expect(
      snapshotConditionSuggestions({
        foregroundApp: "com.android.settings",
        treeApp: "ai.x.grok",
        nodes: [
          { bundleId: "ai.x.grok", label: "Imagine" },
          { bundleId: "com.android.settings", label: "Permissions" },
        ],
      }),
    ).toEqual(["Permissions"]);
    expect(
      snapshotConditionSuggestions({
        nodes: [{ label: "Order complete" }, { label: "Order complete" }],
      }),
    ).toEqual(["Order complete"]);
  });
});
