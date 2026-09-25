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
        id: "run-member:frames/001.png:" + "b".repeat(64),
        stateId: "screen-home",
        variantId: "member",
        runId: "run-member",
        framePath: "frames/001.png",
        imageSha256: "b".repeat(64),
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
        id: "open-help",
        fromStateId: "screen-home",
        toStateId: "screen-settings",
        kind: "authored",
        label: "Authored help",
        hotspot: { connectionId: "open-help", point: { x: 0.2, y: 0.2 }, actions: [] },
      },
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
        hotspot: {
          connectionId: "home-shortcut",
          point: { x: 0.9, y: 0.9 },
          actions: [{ kind: "tap", label: "Home" }],
        },
      },
      {
        id: "open-missing",
        fromStateId: "screen-language",
        toStateId: "screen-missing",
        kind: "recorded",
        label: "Missing next",
        provenance: { runId: "run-member" },
      },
      {
        id: "guess-settings",
        fromStateId: "screen-home",
        toStateId: "screen-settings",
        kind: "suggested",
        label: "Guess settings",
        provenance: { runId: "run-member" },
        hotspot: { connectionId: "guess-settings", point: { x: 0.8, y: 0.8 }, actions: [] },
      },
    ],
    findings: [
      {
        id: "run-member:frames/002.png::" + "b".repeat(64) + ":old",
        runId: "run-member",
        captureId: "frames/002.png::" + "b".repeat(64),
        action: "accept",
        note: "Earlier acceptance",
        decidedAt: 1,
        decidedBy: "human:old",
        reviewVersion: 1,
      },
      {
        id: "run-member:frames/002.png::" + "b".repeat(64),
        runId: "run-member",
        captureId: "frames/002.png::" + "b".repeat(64),
        action: "report-issue",
        note: "Save overlaps the seats row",
        decidedAt: 40,
        decidedBy: "human:demo",
        reviewVersion: 2,
      },
    ],
    missing: [
      {
        stateId: "screen-language",
        variantId: "admin",
        reason: "No capture for this state in configuration chrome · admin.",
      },
      {
        stateId: "screen-home",
        variantId: "signed-out",
        reason: "Signed out was not captured.",
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

async function renderWalkthrough(path: string, service: RunProductService = playerService()) {
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
        runService={service}
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

async function choose(label: string, option: string) {
  await click(document.querySelector<HTMLElement>(`[role="combobox"][aria-label="${label}"]`)!);
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.startsWith(option),
  );
  if (!item) throw new Error(`Missing ${label} option: ${option}`);
  await click(item);
}

function text(): string {
  return document.body.textContent ?? "";
}

describe("Run walkthrough player", () => {
  it("retries a walkthrough outage without calling saved evidence missing", async () => {
    const service = playerService();
    let attempts = 0;
    service.getPlayerManifest = async () => {
      if (++attempts === 1) throw new TypeError("Failed to fetch");
      return manifest();
    };
    await renderWalkthrough("/runs/run-member/walkthrough", service);
    expect(text()).toContain("Relay is not connected");
    expect(text()).not.toContain("No player manifest");
    expect(document.querySelector('a[href="/runs/run-member"]')).not.toBeNull();
    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    )!;
    await click(retry);
    expect(attempts).toBe(2);
    expect(text()).toContain("Member home");
    expect(text()).not.toContain("Relay is not connected");
  });

  it("distinguishes unavailable images from missing captures and retries before enabling review", async () => {
    const current = manifest();
    current.findings = [];
    let attempts = 0;
    const source = playerService();
    const service = {
      ...source,
      getPlayerManifest: async () => current,
      loadFrame: async () => {
        if (++attempts === 1) throw new Error("temporary outage");
        return source.loadFrame!("run-member", "frames/001.png");
      },
      reviewCapture: async () => {
        throw new Error("must not review without image");
      },
    } as RunProductService;
    await renderWalkthrough("/runs/run-member/walkthrough", service);
    expect(text()).toContain("Screenshot unavailable");
    expect(text()).not.toContain("has no screenshot for this configuration");
    const approve = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Looks correct",
    )!;
    expect(approve.disabled).toBe(true);
    await click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Try again",
      )!,
    );
    await settle();
    expect(document.querySelector("img[alt^='Member home']")).not.toBeNull();
    expect(approve.disabled).toBe(false);
  });

  it("shows the entry state capture with recorded links, without report data", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough");
    expect(text()).toContain("Member home");
    expect(text()).toContain("Browse the screens captured during this run.");
    expect(document.querySelector('[role="combobox"][aria-label="Screen"]')).not.toBeNull();
    expect(text()).toContain("Member settings");
    expect(text()).toContain("Recorded connection");
    // The stage shows the exact capture's frame metadata.
    expect(text()).toContain("frames/001.png");
    expect(text()).toContain("Suggested connection");
    expect(document.querySelector("[data-recorded='false']")).toBeNull();
    expect(text()).not.toContain("recorded in run undefined");
    expect(document.querySelector('[aria-label="Configuration"]')?.textContent).toContain(
      "firefox · member",
    );
    expect(text()).not.toContain("Save overlaps the seats row");
    expect(document.querySelector("img")).not.toBeNull();
    expect(
      document.querySelector("[data-recorded='true']")?.getAttribute("data-hotspot-index"),
    ).toBe("1");
    expect(document.querySelector("[data-recorded='false']")).toBeNull();
  });

  it("keeps the selected configuration in the address when opening a screen", async () => {
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough");
    await choose("Configuration", "chrome · admin");
    await choose("Screen", "Workspace settings");
    expect(history.location.search).toMatch(/variant=admin/u);
    expect(history.location.search).toMatch(/state=screen-settings/u);
  });

  it("pins the opening configuration in the address", async () => {
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough");
    expect(history.location.search).toMatch(/variant=member/u);
    expect(history.location.search).toMatch(/state=screen-home/u);
  });

  it("opens a captureless configuration without another account's image", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough");
    await choose("Configuration", "signed out");
    expect(text()).toContain("Signed out was not captured.");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[aria-label="Screen"]')?.textContent).toContain("Not captured");
    await choose("Screen", "Workspace settings");
    expect(text()).toContain("Not captured in this configuration");
    expect(text()).toContain("Workspace settings was not captured");
    expect(text()).toContain("No connected screenshots from this screen.");
    expect(text()).not.toContain("recorded in run");
    expect(document.querySelector("img")).toBeNull();
  });

  it("replaces an unknown screen in the address with the entry screen", async () => {
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough?state=not-a-screen");
    expect(history.location.search).toMatch(/state=screen-home/u);
    expect(history.location.search).not.toMatch(/not-a-screen/u);
  });

  it("replaces an unknown configuration in the address with one that was captured", async () => {
    const { history } = await renderWalkthrough(
      "/runs/run-member/walkthrough?variant=not-a-configuration",
    );
    expect(history.location.search).toMatch(/variant=member/u);
    expect(history.location.search).not.toMatch(/not-a-configuration/u);
  });

  it("says an authored destination was not captured in this configuration", async () => {
    await renderWalkthrough(
      "/runs/run-member/walkthrough?variant=signed-out&state=screen-language",
    );
    expect(text()).toContain("Planned connection · Screenshot unavailable");
    expect(document.querySelector("img")).toBeNull();
  });

  it("says a recorded destination was not captured in this configuration", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough?state=screen-language");
    expect(text()).toContain("Recorded connection · Screenshot unavailable");
    expect(
      [...document.querySelectorAll("button[data-hotspot-index]")].some((button) =>
        button.textContent?.includes("Screenshot unavailable"),
      ),
    ).toBe(false);
  });

  it("does not substitute a URL capture that belongs to another configuration", async () => {
    const memberCapture = "run-member:frames/001.png:" + "b".repeat(64);
    await renderWalkthrough(
      `/runs/run-admin/walkthrough?variant=admin&state=screen-home&capture=${encodeURIComponent(memberCapture)}`,
    );
    expect(document.querySelector("img")).toBeNull();
    expect(text()).toContain("Not captured in this configuration");
  });

  it("exports the walkthrough for every pinned run except the page run", async () => {
    const joined: string[][] = [];
    const service = playerService();
    service.exportWalkthrough = async (id, withRunIds) => {
      joined.push([id, ...(withRunIds ?? [])]);
      return { fileName: "pack.json", digest: `sha256:${"a".repeat(64)}`, body: "{}" };
    };
    await renderWalkthrough("/runs/run-member/walkthrough", service);
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.getAttribute("aria-label") === "Export walkthrough",
    );
    if (!button) throw new Error("export walkthrough missing");
    await click(button);
    expect(text()).not.toContain("Save walkthrough");
    expect(joined).toEqual([["run-member", "run-admin"]]);
  });

  it("shows why a walkthrough export was refused", async () => {
    const service = playerService();
    let fail = false;
    service.exportWalkthrough = async () => {
      if (fail) {
        throw new Error("Run unscoped-run has no App Map plan identity and cannot be joined");
      }
      return { fileName: "pack.html", digest: `sha256:${"a".repeat(64)}`, body: "<html></html>" };
    };
    await renderWalkthrough("/runs/run-member/walkthrough", service);
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.getAttribute("aria-label") === "Export walkthrough",
    );
    if (!button) throw new Error("export walkthrough missing");
    await click(button);
    expect(text()).not.toContain("Save walkthrough");
    fail = true;
    await click(button);
    expect(text()).toContain("Run unscoped-run has no App Map plan identity and cannot be joined");
    expect(text()).not.toContain("Save walkthrough");
  });

  it("follows the exact recorded capture and preserves it through Back and Forward", async () => {
    const data = manifest();
    const exact = data.captures.find(
      (item) => item.stateId === "screen-settings" && item.variantId === "member",
    )!;
    const service = playerService();
    service.reviewCapture = async () => {
      throw new Error("Review must not be submitted during navigation");
    };
    service.getPlayerManifest = async () => ({
      ...data,
      captures: [
        ...data.captures,
        { ...exact, id: "newer-settings", framePath: "frames/newer.png", capturedAt: 999 },
      ],
      connections: data.connections.map((item) =>
        item.id === "open-settings"
          ? { ...item, provenance: { runId: "run-member", captureId: exact.id } }
          : item,
      ),
    });
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough", service);
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Member settings"),
      )!,
    );
    expect(new URLSearchParams(history.location.search).get("capture")).toBe(exact.id);
    expect(text()).toContain("frames/002.png");
    expect(text()).not.toContain("frames/newer.png");
    expect(
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Looks correct"),
      ),
    ).toBe(true);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Back"]')!);
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Forward"]')!);
    expect(new URLSearchParams(history.location.search).get("capture")).toBe(exact.id);
  });

  it("navigates via a recorded link and Back retains context", async () => {
    const { history } = await renderWalkthrough("/runs/run-member/walkthrough");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        b.textContent?.includes("Member settings"),
      )!,
    );
    expect(text()).toContain("Workspace settings");
    expect(text()).toContain("Current review · report-issue");
    expect(text()).not.toContain("Current review · accept");
    const body = text();
    expect(body.indexOf("Current review · report-issue")).toBeLessThan(
      body.indexOf("Earlier review · accept"),
    );
    await choose("Screen", "Preferred language");
    expect(text()).toContain("Preferred language");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.getAttribute("aria-label") === "Back",
      )!,
    );
    expect(text()).toContain("Workspace settings");
    await choose("Configuration", "chrome · admin");
    expect(text()).toContain("run-admin");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Back",
      )!,
    );
    expect(text()).toContain("Member home");
    const alt = document.querySelector("img")?.getAttribute("alt") ?? "";
    expect(alt.startsWith("Member home")).toBe(true);
    expect(alt.includes("Admin")).toBe(false);
    expect(history.location.pathname).toBe("/runs/run-member/walkthrough");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Forward",
      )!,
    );
    expect(text()).toContain("Preferred language");
    await choose("Screen", "Preferred language");
    await click(
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Back",
      )!,
    );
    expect(text()).toContain("Workspace settings");
  });

  it("keeps missing states explicit: the admin variant never substitutes member evidence", async () => {
    await renderWalkthrough("/runs/run-admin/walkthrough?variant=admin&state=screen-language");
    expect(text()).toContain("No capture for this configuration");
    expect(document.querySelector("img")).toBeNull();
    // The state rail marks the missing state for this configuration.
    expect(document.querySelector('[aria-label="Screen"]')?.textContent).toContain("Not captured");
  });

  it("switching variants keeps the current state and resolves exact evidence", async () => {
    await renderWalkthrough("/runs/run-member/walkthrough?state=screen-settings");
    expect(text()).toContain("frames/002.png");
    expect(text()).toContain("bbbbbbbb");
    await choose("Configuration", "chrome · admin");
    await settle();
    // Same logical state, different exact evidence.
    expect(text()).toContain("Workspace settings");
    expect(text()).toContain("frames/002.png");
    expect(text()).toContain("eeeeeeee");
  });
});

describe("Run walkthrough review controls", () => {
  it("reports an issue on the exact capture and shows the decision without leaving the player", async () => {
    const reviewed: string[] = [];
    const current = manifest();
    const service: RunProductService = {
      async getPlayerManifest() {
        // Fresh reference per fetch: structural sharing must see a change.
        return structuredClone(current);
      },
      async loadFrame() {
        const bytes = Uint8Array.from(atob(PNG_1PX.split(",")[1]!), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: "image/png" });
      },
      async reviewCapture(input: {
        runId: string;
        captureId: string;
        action: string;
        note?: string;
      }) {
        reviewed.push(`${input.runId}:${input.captureId}:${input.action}`);
        // The next manifest read reflects the decision (server-side truth).
        current.findings = [
          ...current.findings,
          {
            id: `${input.runId}:${input.captureId}`,
            runId: input.runId,
            captureId: input.captureId,
            action: "report-issue",
            note: input.note,
            decidedAt: 50,
            decidedBy: "human:test",
            reviewVersion: 1,
          },
        ];
        return { ok: true } as never;
      },
    } as unknown as RunProductService;

    const platform: Platform = {
      platform: "web",
      getServerUrl: () => "http://127.0.0.1:8787",
      storage: { get: () => null, set: () => undefined, remove: () => undefined },
    };
    const history = createMemoryHistory({
      initialEntries: ["/runs/run-member/walkthrough?state=screen-home"],
    });
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
          runService={service}
        />,
      );
    });
    await settle();

    const report = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Report issue"),
    );
    if (!report) throw new Error("Report issue action missing");
    await click(report);
    expect(reviewed).toHaveLength(0);
    expect(document.querySelector('[aria-label="Issue note"]')).not.toBeNull();
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Save issue"),
    );
    if (!save) throw new Error("Save issue action missing");
    await click(save);
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toContain("frames/001.png::" + "b".repeat(64));
    expect(reviewed[0]).toContain("report-issue");
    // After the manifest refresh the decision is bound to the exact capture.
    expect(text()).toContain("Review decision on this capture");
    expect(text()).toContain("human:test");
  });
});
