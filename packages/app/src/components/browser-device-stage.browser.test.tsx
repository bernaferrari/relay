import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import {
  compileBrowserEnvironment,
  type BrowserDeviceSession,
  type BrowserDeviceSemanticOverlay,
} from "@relay/protocol";
import type { Frame } from "../lib/api-types";

const serverMock = vi.hoisted(() => ({ current: undefined as unknown }));
const recorderMock = vi.hoisted(() => ({ current: undefined as unknown }));
const frameSourceMock = vi.hoisted(() => ({
  current: (() => "blob:browser-frame") as () => string,
}));

vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));
vi.mock("../context/recorder", () => ({ useRecorder: () => recorderMock.current }));
vi.mock("../lib/use-device-stage-live-frame", () => ({
  useDeviceStageLiveFrame: () => () => frameSourceMock.current(),
}));
vi.mock("../lib/use-device-stage-keyboard", () => ({
  useDeviceStageKeyboard: () => undefined,
}));
vi.mock("./device-interaction-surface", () => ({
  DeviceInteractionSurface: (props: {
    disabled?: Accessor<boolean>;
    viewOnly?: Accessor<boolean>;
    ariaLabel?: string;
  }) => (
    <div
      data-testid="browser-device-interaction"
      aria-disabled={props.disabled?.() ?? false}
      data-view-only={String(props.viewOnly?.() ?? false)}
      aria-label={props.ariaLabel}
    />
  ),
}));

import { BrowserDeviceStage } from "./browser-device-stage";

const profile = compileBrowserEnvironment({
  engine: "webkit",
  viewport: { width: 390, height: 844 },
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  networkProfile: "network:offline-fixture",
  authenticationFixtureId: "auth:staging",
  environmentRevision: "fixture-v2",
});

const overlay: BrowserDeviceSemanticOverlay = {
  schemaVersion: 1,
  sessionId: "session-browser-1",
  pageId: "page-browser-1",
  sequence: 1,
  visualFingerprint: "frame-1",
  capturedAt: 2,
  candidates: [],
  truncated: false,
};

function makeSession(
  status: BrowserDeviceSession["status"] = "streaming",
  ownership: BrowserDeviceSession["ownership"] = "controlled",
): BrowserDeviceSession {
  return {
    schemaVersion: 1,
    sessionId: "session-browser-1",
    targetId: "browser-1",
    status,
    ownership,
    sequence: 1,
    activePageId: "page-browser-1",
    pages: [
      {
        id: "page-browser-1",
        kind: "page",
        title: "Checkout",
        url: "https://example.test/checkout",
        active: true,
        closed: false,
      },
    ],
    profile,
    startedAt: 1,
    ...(status === "streaming" ? {} : { issue: `Browser is ${status}.` }),
  };
}

const frame: Frame = {
  id: "frame-browser-1",
  capturedAt: 2,
  mime: "image/jpeg",
  base64: "AA==",
  bytes: 1,
  serial: "browser-1",
  caption: "browser · frame 1",
  width: 390,
  height: 844,
  visualFingerprint: "frame-1",
  browserDevice: { sessionId: "session-browser-1", pageId: "page-browser-1", sequence: 1 },
};

function mount(input: {
  session?: BrowserDeviceSession;
  liveFrame?: Frame | null;
  recording?: boolean;
  source?: string;
  selectedDevice?: string;
}) {
  const [currentSession] = createSignal<BrowserDeviceSession | null>(
    input.session ?? makeSession(),
  );
  const [currentFrame] = createSignal<Frame | null>(
    input.liveFrame === undefined ? frame : input.liveFrame,
  );
  const [currentOverlay, setCurrentOverlay] = createSignal<BrowserDeviceSemanticOverlay | null>(
    null,
  );
  const openBrowserDevice = vi.fn(async () => currentSession()!);
  const navigateBrowserDevice = vi.fn(async () => true);
  const server = {
    browserDeviceSession: currentSession,
    browserDeviceSemanticOverlay: currentOverlay,
    selectedDevice: () => input.selectedDevice ?? null,
    selectedLeaseId: () => (input.session?.ownership === "occupied" ? null : "lease-browser-1"),
    liveFrame: currentFrame,
    liveCaptureIssue: () => null,
    pollLiveFrame: vi.fn(async () => undefined),
    browserDeviceHistory: vi.fn(async () => true),
    navigateBrowserDevice,
    openBrowserDevice,
    inspectBrowserDevice: vi.fn(async () => {
      setCurrentOverlay(overlay);
      return overlay;
    }),
    clickBrowserDevice: vi.fn(async () => true),
    scrollDevice: vi.fn(async () => true),
    browserDeviceWheel: vi.fn(async () => true),
    browserDeviceKey: vi.fn(async () => true),
    activateBrowserDevicePage: vi.fn(async () => true),
    closeBrowserDevicePage: vi.fn(async () => true),
  };
  serverMock.current = server;
  recorderMock.current = {
    recording: () => input.recording ?? false,
    driveTap: vi.fn(async () => undefined),
    driveSwipe: vi.fn(async () => undefined),
  };
  frameSourceMock.current = () => input.source ?? "blob:browser-frame";
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <BrowserDeviceStage />, root);
  return { root, dispose, server };
}

test("Browser Device polling idles, then accelerates after interaction", async () => {
  vi.useFakeTimers();
  try {
    const view = mount({ selectedDevice: "browser-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.server.pollLiveFrame).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(view.server.pollLiveFrame).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.server.pollLiveFrame).toHaveBeenCalledTimes(2);

    view.root
      .querySelector("[data-browser-device-stage]")!
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(view.server.pollLiveFrame).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(view.server.pollLiveFrame).toHaveBeenCalledTimes(4);
    view.dispose();
  } finally {
    vi.useRealTimers();
  }
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("Browser Device stage keeps address, labels, and frozen environment inspectable", async () => {
  const view = mount({});
  const address = view.root.querySelector<HTMLInputElement>("#browser-device-url")!;
  address.value = "https://example.test/settings";
  address.dispatchEvent(new Event("input", { bubbles: true }));
  address.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();

  expect(view.server.navigateBrowserDevice).toHaveBeenCalledWith("https://example.test/settings");
  expect(view.root.querySelector("[data-browser-environment]")?.textContent).toContain("pt-BR");
  expect(view.root.querySelector("[data-browser-environment]")?.textContent).toContain(
    "auth:staging",
  );

  const inspect = [...view.root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Inspect labels"),
  )!;
  inspect.click();
  await settle();
  expect(inspect.textContent).toContain("Hide labels");
  expect(view.root.querySelector("[data-browser-semantic-overlay]")).toBeTruthy();
  inspect.click();
  expect(view.root.querySelector("[data-browser-semantic-overlay]")).toBeNull();
  view.dispose();
});

test("Browser Device stage exposes view-only, degraded, and reopen states", () => {
  const occupied = mount({ session: makeSession("streaming", "occupied") });
  expect(
    occupied.root.querySelector<HTMLElement>("[data-testid='browser-device-interaction']")?.dataset
      .viewOnly,
  ).toBe("true");
  expect(occupied.root.querySelector<HTMLInputElement>("#browser-device-url")?.disabled).toBe(true);
  occupied.dispose();

  const degraded = mount({ session: makeSession("degraded"), source: "" });
  expect(degraded.root.querySelector("[data-browser-device-stage]")?.textContent).toContain(
    "Browser is degraded.",
  );
  expect(degraded.root.textContent).not.toContain("Reopen browser");
  degraded.dispose();

  const crashed = mount({ session: makeSession("crashed"), source: "" });
  const reopen = [...crashed.root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Reopen browser"),
  );
  expect(reopen?.disabled).toBe(false);
  reopen?.click();
  expect(crashed.server.openBrowserDevice).toHaveBeenCalledOnce();
  crashed.dispose();

  const closed = mount({ session: makeSession("closed"), source: "" });
  expect(closed.root.textContent).toContain("Browser is closed.");
  expect(closed.root.textContent).toContain("Reopen browser");
  closed.dispose();
});

test("Browser Device stage preserves popup controls and recorder lockout", () => {
  const popupSession = makeSession();
  popupSession.pages = [
    ...popupSession.pages,
    {
      id: "popup-browser-1",
      kind: "popup",
      title: "Sign in",
      url: "https://example.test/sign-in",
      active: false,
      closed: false,
    },
  ];
  const popup = mount({ session: popupSession });
  const popupTab = [
    ...popup.root.querySelectorAll<HTMLButtonElement>("button[aria-pressed='false']"),
  ].find((button) => button.textContent?.includes("Sign in"));
  popupTab?.click();
  expect(popup.server.activateBrowserDevicePage).toHaveBeenCalledWith("popup-browser-1");
  const closePopup = popup.root.querySelector<HTMLButtonElement>(
    "button[aria-label='Close Sign in']",
  );
  expect(closePopup).toBeTruthy();
  closePopup?.click();
  expect(popup.server.closeBrowserDevicePage).toHaveBeenCalledWith("popup-browser-1");
  popup.dispose();

  const recording = mount({ recording: true });
  expect(recording.root.querySelector<HTMLInputElement>("#browser-device-url")?.disabled).toBe(
    true,
  );
  expect(
    recording.root.querySelector("button[title='Setup controls pause while recording']"),
  ).toBeTruthy();
  recording.dispose();
});
