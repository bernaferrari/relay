import { describe, expect, it } from "vitest";
import type { ProductDevice } from "../data/device-product-service";
import {
  destinationItemAction,
  destinationItems,
  destinationManageAction,
  destinationRunTargetId,
  matchRunTargetId,
  summarizeDestinations,
  incompatibleSavedProfile,
  startConfigurationAdmission,
  workspaceDestinationDecision,
} from "./destination-summary";

function device(
  id: string,
  name: string,
  status: ProductDevice["status"],
  platform: ProductDevice["platform"] = "ios",
): Pick<ProductDevice, "id" | "serial" | "name" | "status" | "platform" | "osVersion" | "kind"> {
  return {
    id,
    serial: id,
    name,
    status,
    platform,
    kind: platform === "browser" ? "Managed browser" : "Physical device",
    ...(platform === "ios" ? { osVersion: "18.5" } : {}),
  };
}

describe("destination summary", () => {
  it("shows the single available destination by name", () => {
    expect(
      summarizeDestinations({
        status: "success",
        devices: [device("ipad", "Design iPad", "ready")],
      }),
    ).toEqual({
      label: "Design iPad",
      detail: "iOS 18.5",
      tone: "ready",
    });
  });

  it("counts ready devices and managed browsers together", () => {
    expect(
      summarizeDestinations({
        status: "success",
        devices: [
          device("ipad", "Design iPad", "ready"),
          device("browser", "Checkout browser", "virtual", "browser"),
          device("phone", "QA phone", "needs-attention", "android"),
        ],
      }),
    ).toEqual({
      label: "2 devices",
      detail: "Design iPad, Checkout browser",
      tone: "ready",
    });
  });

  it("names attention when nothing is available to run", () => {
    expect(
      summarizeDestinations({
        status: "success",
        devices: [device("phone", "QA phone", "needs-attention", "android")],
      }),
    ).toEqual({
      label: "Needs attention",
      detail: "Reconnect a device to run tests",
      tone: "attention",
    });
  });

  it("stays empty, loading, or unavailable without inventing a destination", () => {
    expect(summarizeDestinations({ status: "pending" })).toMatchObject({
      label: "Checking…",
      tone: "loading",
    });
    expect(summarizeDestinations({ status: "error" })).toMatchObject({
      label: "Unavailable",
      tone: "unavailable",
    });
    expect(summarizeDestinations({ status: "success", devices: [] })).toEqual({
      label: "No device",
      detail: "Connect a Device or start a Browser",
      tone: "empty",
    });
  });

  it("lists ready destinations before ones that need attention", () => {
    expect(
      destinationItems([
        device("phone", "QA phone", "needs-attention", "android"),
        device("browser", "Checkout browser", "virtual", "browser"),
        device("ipad", "Design iPad", "ready"),
      ]).map((item) => item.id),
    ).toEqual(["ipad", "browser", "phone"]);
  });

  it("selects a run destination instead of navigating to device management", () => {
    expect(destinationItemAction({ id: "ipad" })).toEqual({ kind: "select", targetId: "ipad" });
    expect(destinationItemAction({ id: "chrome-staging" })).toEqual({
      kind: "select",
      targetId: "chrome-staging",
    });
    expect(destinationManageAction()).toEqual({ kind: "manage", href: "/devices" });
    expect(destinationItemAction({ id: "ipad" })).not.toHaveProperty("href");
  });

  it("selects the run target identity, not the catalog device id", () => {
    expect(destinationRunTargetId({ id: "ios-id", serial: "ios-serial" })).toBe("ios-serial");
    expect(destinationItemAction({ id: "ios-id", serial: "ios-serial" })).toEqual({
      kind: "select",
      targetId: "ios-serial",
    });
    expect(
      destinationItems([
        {
          id: "ios-id",
          serial: "ios-serial",
          name: "QA iPhone",
          status: "ready",
          platform: "ios",
          kind: "Physical device",
          osVersion: "18.5",
        },
      ]).map((item) => ({ id: item.id, targetId: item.targetId })),
    ).toEqual([{ id: "ios-id", targetId: "ios-serial" }]);
    expect(
      matchRunTargetId("ios-serial", [{ targetId: "ios-serial" }, { targetId: "browser-id" }]),
    ).toBe("ios-serial");
    expect(matchRunTargetId("ios-id", [{ targetId: "ios-serial" }])).toBeUndefined();
  });

  it("applies a toolbar destination once and then leaves in-page target changes alone", () => {
    const available = ["ios-serial", "browser-golden"];
    expect(
      workspaceDestinationDecision({
        storedTargetId: "ios-serial",
        availableTargetIds: available,
      }),
    ).toEqual({ kind: "apply", targetId: "ios-serial" });
    expect(
      workspaceDestinationDecision({
        storedTargetId: "ios-serial",
        lastAppliedTargetId: "ios-serial",
        currentTargetId: "browser-golden",
        availableTargetIds: available,
      }),
    ).toEqual({ kind: "skip" });
    expect(
      workspaceDestinationDecision({
        storedTargetId: "ios-id",
        availableTargetIds: available,
      }),
    ).toEqual({ kind: "skip" });
  });

  it("does not let a workspace default overwrite a saved Test destination", () => {
    expect(
      workspaceDestinationDecision({
        storedTargetId: "emulator-5554",
        currentTargetId: "browser-golden",
        availableTargetIds: ["emulator-5554", "browser-golden"],
        origin: "saved-test",
        protectedTargetId: "browser-golden",
      }),
    ).toEqual({ kind: "skip" });
    expect(
      workspaceDestinationDecision({
        storedTargetId: "emulator-5554",
        currentTargetId: "browser-golden",
        availableTargetIds: ["emulator-5554", "browser-golden"],
        origin: "explicit-user-selection",
      }),
    ).toEqual({ kind: "skip" });
    expect(
      workspaceDestinationDecision({
        storedTargetId: "emulator-5554",
        currentTargetId: undefined,
        availableTargetIds: ["emulator-5554", "browser-golden"],
        origin: "workspace-default",
      }),
    ).toEqual({ kind: "apply", targetId: "emulator-5554" });
  });

  it("keeps an incompatible saved account visible instead of clearing it", () => {
    expect(
      incompatibleSavedProfile({
        savedProfileId: "profile-member",
        targetId: "emulator-5554",
        profiles: [
          {
            id: "profile-member",
            name: "Member",
            targetId: "browser-golden",
            account: { name: "Member" },
          },
        ],
      }),
    ).toEqual({
      id: "saved-profile",
      label: "Member is saved for another destination",
      detail: "Choose that device or browser, or use a different saved setup.",
    });
    expect(
      incompatibleSavedProfile({
        savedProfileId: "profile-member",
        targetId: "browser-golden",
        profiles: [
          {
            id: "profile-member",
            name: "Member",
            targetId: "browser-golden",
            account: { name: "Member" },
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("blocks start while a saved profile list is still resolving", () => {
    const admission = startConfigurationAdmission({
      savedProfileId: "profile-member",
      targetId: "browser-golden",
    });
    expect(admission.status).toBe("resolving");
    expect(admission.start.targetProfileId).toBe("profile-member");
    expect(
      incompatibleSavedProfile({
        savedProfileId: "profile-member",
        targetId: "browser-golden",
      })?.resolving,
    ).toBe(true);
  });

  it("keeps an explicit missing build on the would-be start payload", () => {
    const admission = startConfigurationAdmission({
      selectedBuildId: "build-92",
      buildsStatus: "success",
      builds: [{ id: "build-91", status: "ready", sourceSha: "abcdef1234567" }],
    });
    expect(admission.status).toBe("blocked");
    expect(admission.start.selectedBuildId).toBe("build-92");
    expect(admission.blockers.some((item) => item.id === "selected-build")).toBe(true);
  });

  it("blocks a ready selected build that has no bindable source identity", () => {
    const admission = startConfigurationAdmission({
      selectedBuildId: "build-92",
      buildsStatus: "success",
      builds: [{ id: "build-92", status: "ready" }],
    });
    expect(admission.status).toBe("blocked");
    expect(admission.start.selectedBuildId).toBe("build-92");
    expect(admission.start.sourceRevision).toBeUndefined();
    expect(admission.blockers.some((item) => item.id === "selected-build")).toBe(true);
  });

  it("blocks start while an explicit build list is still resolving", () => {
    const admission = startConfigurationAdmission({
      selectedBuildId: "build-92",
      buildsStatus: "pending",
    });
    expect(admission.status).toBe("resolving");
    expect(admission.start.selectedBuildId).toBe("build-92");
  });
});
