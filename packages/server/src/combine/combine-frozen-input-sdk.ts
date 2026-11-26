import { writeFile } from "node:fs/promises";

export const targetId = "12345678-1234-1234-1234-123456789ABC";
export const appBundleId = "com.example.frozen-input-fixture";
export const nodes = [
  {
    index: 0,
    depth: 0,
    type: "Application",
    bundleId: appBundleId,
    rect: { x: 0, y: 0, width: 834, height: 1112 },
  },
  {
    index: 1,
    depth: 1,
    parentIndex: 0,
    type: "TextField",
    identifier: "composer",
    label: "Composer",
    bundleId: appBundleId,
    hittable: true,
    rect: { x: 10, y: 10, width: 300, height: 44 },
  },
];
export const typed: string[] = [];
export const forbiddenInputs: string[] = [];
let typeGate: Promise<void> | undefined;
export function holdTypeUntil(gate: Promise<void>) {
  typeGate = gate;
}

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLh7wAAAABJRU5ErkJggg==";
const forbidden = (kind: string) => async () => {
  forbiddenInputs.push(kind);
  throw new Error(`Unexpected fixture input: ${kind}`);
};

/** Test-only SDK transport. No method contacts a daemon, platform tool or device. */
export function createAgentDeviceClient() {
  return {
    devices: {
      list: async () => [
        {
          id: targetId,
          name: "Frozen input simulator",
          platform: "ios",
          kind: "Simulator",
          booted: true,
          ios: { udid: targetId },
        },
      ],
      boot: forbidden("boot"),
    },
    sessions: { close: async () => ({ ok: true }) },
    apps: { open: async () => ({ ok: true }), close: forbidden("close-app") },
    capture: {
      snapshot: async () => ({ nodes: structuredClone(nodes), truncated: false }),
      screenshot: async (input?: { path?: string }) => {
        if (input?.path) await writeFile(input.path, Buffer.from(png, "base64"));
        return { base64: png };
      },
    },
    interactions: {
      type: async (input: { text: string }) => {
        await typeGate;
        typed.push(input.text);
        return { ok: true };
      },
      find: async () => ({ exists: true }),
      press: forbidden("tap"),
      longPress: forbidden("long-press"),
      fill: forbidden("fill"),
      scroll: forbidden("scroll"),
      swipe: forbidden("swipe"),
      pan: forbidden("pan"),
    },
    command: {
      wait: async () => ({ ok: true }),
      appState: async () => ({
        platform: "ios",
        appName: "Fixture",
        appBundleId,
        source: "session",
        surface: "app",
      }),
      back: forbidden("back"),
      home: forbidden("home"),
      clipboard: forbidden("clipboard"),
      keyboard: forbidden("keyboard"),
      alert: forbidden("alert"),
      appSwitcher: forbidden("app-switcher"),
      orientation: forbidden("orientation"),
      prepare: forbidden("prepare"),
    },
    settings: { update: forbidden("setting") },
    recording: { record: async () => ({ ok: true }) },
    observability: {
      perf: async () => ({ samples: [] }),
      logs: async () => ({ entries: [] }),
      network: async () => ({ entries: [] }),
      audio: async () => ({ entries: [] }),
      crashes: async () => ({ entries: [], truncated: false }),
    },
  };
}
