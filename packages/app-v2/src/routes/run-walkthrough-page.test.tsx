/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type { PlayerManifestProjection, RunProductService } from "../data/run-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const recordingService = {} as RecordingProductService;

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=";

function manifest(): PlayerManifestProjection {
  return {
    schemaVersion: 1,
    pinned: {
      appMapId: "slice4-reference",
      appMapRevision: 63,
      runIds: ["run-member", "run-admin"],
      generatedAt: 1,
    },
    entryStateId: "screen-home",
    states: [
      { id: "screen-home", title: "Member home" },
      { id: "screen-settings", title: "Workspace settings" },
      { id: "screen-language", title: "Preferred language" },
    ],
    variants: [
      { id: "member", label: "firefox · member" },
      { id: "admin", label: "chrome · admin" },
    ],
    captures: [
      {
        id: "run-member:frames/001.png:" + "a".repeat(64),
        stateId: "screen-home",
        variantId: "member",
        runId: "run-member",
        framePath: "frames/001.png",
        imageSha256: "a".repeat(64),
        caption: "Member home",
        capturedAt: 10,
      },
      {
        id: "run-member:frames/002.png:" + "b".repeat(64),
        stateId: "screen-settings",
        variantId: "member",
        runId: "run-member",
        framePath: "frames/002.png",
        imageSha256: "b".repeat(64),
        caption: "Settings",
        capturedAt: 20,
      },
      {
        id: "run-member:frames/003.png:" + "c".repeat(64),
        stateId: "screen-language",
        variantId: "member",
        runId: "run-member",
        framePath: "frames/003.png",
        imageSha256: "c".repeat(64),
        caption: "Language",
        capturedAt: 30,
      },
      {
        id: "run-admin:frames/001.png:" + "d".repeat(64),
        stateId: "screen-home",
        variantId: "admin",
        runId: "run-admin",
        framePath: "frames/001.png",
        imageSha256: "d".repeat(64),
        caption: "Admin home",
        capturedAt: 25,
      },
      {
        id: "run-admin:frames/002.png:" + "e".repeat(64),
        stateId: "screen-settings",
        variantId: "admin",
        runId: "run-admin",
        framePath: "frames/002.png",
        imageSha256: "e".repeat(64),
        caption: "Admin settings",
        capturedAt: 26,
      },
      // Language is deliberately absent for the admin variant.
    ],
    connections: [
      {
        id: "open-settings",
        fromStateId: "screen-home",
        toStateId: "screen-settings",
        kind: "recorded",
        label: "Member settings",
        provenance: { runId: "run-member" },
        hotspot: {
          connectionId: "open-settings",
          point: { x: 0.5, y: 0.1 },
          actions: [{ kind: "tap", label: "Settings" }],
        },
      },
      {
        id: "open-language",
        fromStateId: "screen-settings",
        toStateId: "screen-language",
        kind: "recorded",
        label: "Preferred language",
        provenance: { runId: "run-member" },
        hotspot: { connectionId: "open-language", actions: [{ kind: "tap", label: "Language" }] },
      },
      {
        id: "home-shortcut",
        fromStateId: "screen-language",
        toStateId: "screen-home",
        kind: "authored",
        label: "Back to home",
        hotspot: { connectionId: "home-shortcut", actions: [{ kind: "tap", label: "Home" }] },
      },
    ],
    findings: [
      {
        id: "run-member:frames/002.png::" + "b".repeat(64),
        runId: "run-member",
        captureId: "frames/002.png::" + "b".repeat(64),
        action: "report-issue",
        note: "Save overlaps the seats row",
        decidedAt: 40,
        decidedBy: "human:demo",
        reviewVersion: 1,
      },
    ],
    missing: [
      {
        stateId: "screen-language",
        variantId: "admin",
        reason: "No capture for this state in configuration chrome · admin.",
      },
    ],
  };
}

function playerService(): RunProductService {
  return {
    async getPlayerManifest() {
      return manifest();
    },
    async loadFrame() {
      const bytes = Uint8Array.from(atob(PNG_1PX.split(",")[1]!), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: "image/png" });
    },
  } as unknown as RunProductService;
}

async function renderWalkthrough(path: string) {
  const platform: Platform = {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    storage: {
      get: () => null,
      set: () => undefined,
      remove: () => undefined,
    },
  };
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={recordingService}
        runService={playerService()}
      />,
    );
  });
  await settle();
  return { history };
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

function text(): string {
  return document.body.textContent ?? "";
}

describe("Run walkthrough player", () => {
  it("shows the entry state capture with recorded links, without report data", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough");
    expect(text()).toContain("Member home");
    expect(text()).toContain("Member settings");
    expect(text()).toContain("recorded");
    // The stage shows the exact capture's frame metadata.
    expect(text()).toContain("frames/001.png");
    expect(document.querySelector("img")).not.toBeNull();
  });

  it("navigates via a recorded link and Back retains context", async () => {
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("Member settings"),
      )!,
    );
    expect(text()).toContain("Workspace settings");
    expect(text()).toContain("Save overlaps the seats row");
    // Follow one more link, then Back returns to Settings.
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("Preferred language"),
      )!,
    );
    expect(text()).toContain("Preferred language");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === "Back",
      )!,
    );
    expect(text()).toContain("Workspace settings");
    expect(history.location.pathname).toBe("/runs/run-member/walkthrough");
  });

  it("keeps missing states explicit: the admin variant never substitutes member evidence", async () => {
    await renderWalkthrough("/runs/run-admin/walkthrough?variant=admin&state=screen-language");
    expect(text()).toContain("No capture for this configuration");
    expect(document.querySelector("img")).toBeNull();
    // The state rail marks the missing state for this configuration.
    expect(text()).toContain("missing in this configuration");
  });

  it("switching variants keeps the current state and resolves exact evidence", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough?state=screen-settings");
    expect(text()).toContain("frames/002.png");
    expect(text()).toContain("bbbbbbbb");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("chrome · admin"),
      )!,
    );
    await settle();
    // Same logical state, different exact evidence.
    expect(text()).toContain("Workspace settings");
    expect(text()).toContain("frames/002.png");
    expect(text()).toContain("eeeeeeee");
  });

  it("labels authored links as navigation-only", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough?state=screen-language");
    expect(text()).toContain("Back to home");
    expect(text()).toContain("authored link — navigation only");
  });
});
