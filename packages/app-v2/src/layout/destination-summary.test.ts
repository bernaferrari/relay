import { describe, expect, it } from "vitest";
import type { ProductDevice } from "../data/device-product-service";
import { destinationItems, summarizeDestinations } from "./destination-summary";

function device(
  id: string,
  name: string,
  status: ProductDevice["status"],
  platform: ProductDevice["platform"] = "ios",
): Pick<ProductDevice, "id" | "name" | "status" | "platform" | "osVersion" | "kind"> {
  return {
    id,
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
      label: "2 ready",
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
});
