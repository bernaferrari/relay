import { render } from "solid-js/web";
import { beforeEach, expect, test, vi } from "vitest";

const digest = `sha256:${"a".repeat(64)}` as const;
const deploymentDigest = `sha256:${"b".repeat(64)}` as const;
const testedSha = "2".repeat(40);
const targetCase = {
  id: "target-case:browser:web",
  executionTarget: {
    schemaVersion: 1,
    kind: "local-browser",
    provider: { key: "relay.local.browser", scope: "local" },
    targetId: "web",
    platform: "browser",
    identity: { kind: "browser-target", value: "web" },
  },
  targetProfile: {
    id: "browser:web",
    targetId: "web",
    source: "browser",
    platform: "browser",
    name: "Local Chromium",
    viewport: { width: 1280, height: 800 },
    browserCaseProfile: {
      schemaVersion: 1,
      engine: "chromium",
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      mobile: false,
      touch: false,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "no-preference",
      permissions: [],
      offline: false,
      environmentRevision: "browser-v1",
    },
    capabilities: ["snapshot", "screenshot", "tap"],
    observedAt: 1,
  },
  dimensions: {},
  required: true,
};

const mocks = vi.hoisted(() => ({
  runAction: vi.fn(),
  actorId: vi.fn(() => "human:reviewer"),
}));

vi.mock("../context/server", () => ({
  useServer: () => ({ runAction: mocks.runAction, actorId: mocks.actorId }),
}));

import { ChangesProofSetup } from "./changes-proof-setup";
import { ConfirmDialogHost } from "./confirm-dialog";

function input(root: HTMLElement, id: string, value: string): void {
  const element = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  element.value = value;
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
  );
}

function clickButton(root: ParentNode, label: string): void {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  button.click();
}

function inspection() {
  return {
    schemaVersion: 1,
    change: {
      repository: "acme/web",
      testedSha,
      changedFiles: ["src/settings.tsx"],
    },
    policy: { path: ".relay/change-proof.json", digest: null },
    candidates: {
      commands: [
        {
          executable: "pnpm",
          args: ["run", "build:web"],
          source: "package.json#scripts.build:web",
        },
      ],
      artifacts: [{ path: "dist", platform: "web" }],
      tests: [{ appMapId: "web", testId: "settings", name: "Settings smoke" }],
      targets: [
        {
          targetId: "web",
          profileId: "browser:web",
          name: "Local Chromium",
          platform: "browser",
          targetCase,
        },
      ],
    },
    requiredFields: [],
  } as const;
}

function previewFrom(inputValue: Record<string, unknown>) {
  const build = inputValue.build as Record<string, unknown>;
  const associations = inputValue.associations as readonly Record<string, unknown>[];
  const targetCases = inputValue.targetCases as readonly (typeof targetCase)[];
  return {
    schemaVersion: 1,
    testedSha,
    command: build.command,
    artifact: { path: "dist", digest, sourceSha256: "c".repeat(64) },
    build: {
      id: build.id,
      name: build.name,
      platform: "web",
      configuration: build.configuration,
      environmentRevision: build.environmentRevision,
      webDeployment: build.webDeployment,
    },
    policy: {
      path: ".relay/change-proof.json",
      document: {
        schemaVersion: 1,
        repository: "acme/web",
        changed: {},
        associations,
        builds: [
          {
            id: build.id,
            platform: "web",
            artifactDigest: deploymentDigest,
            sourceSha: testedSha,
            configuration: build.configuration,
            environmentRevision: build.environmentRevision,
          },
        ],
        targetCases,
        policy: { id: "relay.verify-change", version: 2 },
      },
      digest,
      previousDigest: null,
    },
    previewDigest: digest,
  } as const;
}

beforeEach(() => {
  mocks.runAction.mockReset();
  mocks.actorId.mockClear();
});

test("guided web setup inspects, previews exact inputs, and applies only after confirmation", async () => {
  const prepared = vi.fn();
  let reviewedPreview: ReturnType<typeof previewFrom> | undefined;
  mocks.runAction.mockImplementation(async (operationId: string, value: unknown) => {
    if (operationId === "proof.setup.inspect") return inspection();
    if (operationId === "proof.setup.preview") {
      reviewedPreview = previewFrom(value as Record<string, unknown>);
      return reviewedPreview;
    }
    if (operationId === "proof.setup.apply") return { preview: reviewedPreview };
    if (operationId === "proof.prepare") return { proof: { id: "proof-ready" } };
    throw new Error(`Unexpected ${operationId}`);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <>
        <ChangesProofSetup onCancel={vi.fn()} onPrepared={prepared} />
        <ConfirmDialogHost />
      </>
    ),
    root,
  );

  await vi.waitFor(() => expect(root.textContent).toContain("Settings smoke"));
  input(root, "proof-setup-reason", "The reviewed Settings Test covers the changed module.");
  input(root, "proof-setup-deployment-url", "https://preview.example.test");
  input(root, "proof-setup-deployment-digest", deploymentDigest);
  const checkboxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  checkboxes[0]!.click();
  checkboxes[1]!.click();
  root
    .querySelector<HTMLFormElement>("form")!
    .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(root.textContent).toContain("Review before writing"));
  expect(root.textContent).toContain("pnpm run build:web");
  expect(root.textContent).toContain("dist");
  expect(root.textContent).toContain("Reviewed Tests1");
  expect(root.textContent).toContain("Required targets1");
  clickButton(root, "Apply reviewed setup");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Apply this repository Proof setup?"),
  );
  clickButton(document.querySelector('[role="alertdialog"]')!, "Apply reviewed setup");

  await vi.waitFor(() => expect(prepared).toHaveBeenCalledWith({ id: "proof-ready" }));
  expect(mocks.runAction).toHaveBeenCalledWith(
    "proof.setup.apply",
    expect.objectContaining({ confirm: true, testedSha }),
  );
  expect(mocks.runAction).toHaveBeenCalledWith("proof.prepare", {});
  dispose();
  root.remove();
});

test("guided setup keeps artifact drift visible and does not prepare a Proof", async () => {
  const prepared = vi.fn();
  mocks.runAction.mockImplementation(async (operationId: string, value: unknown) => {
    if (operationId === "proof.setup.inspect") return inspection();
    if (operationId === "proof.setup.preview") return previewFrom(value as Record<string, unknown>);
    if (operationId === "proof.setup.apply") {
      throw new Error("build.artifactPath bytes changed after preview; run preview again");
    }
    throw new Error(`Unexpected ${operationId}`);
  });
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <>
        <ChangesProofSetup onCancel={vi.fn()} onPrepared={prepared} />
        <ConfirmDialogHost />
      </>
    ),
    root,
  );
  await vi.waitFor(() => expect(root.textContent).toContain("Settings smoke"));
  input(root, "proof-setup-reason", "The reviewed Test covers the changed module.");
  input(root, "proof-setup-deployment-url", "https://preview.example.test");
  input(root, "proof-setup-deployment-digest", deploymentDigest);
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => box.click());
  root
    .querySelector<HTMLFormElement>("form")!
    .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root.textContent).toContain("Review before writing"));
  clickButton(root, "Apply reviewed setup");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Apply this repository Proof setup?"),
  );
  clickButton(document.querySelector('[role="alertdialog"]')!, "Apply reviewed setup");
  await vi.waitFor(() => expect(root.textContent).toContain("bytes changed after preview"));
  expect(root.querySelector('[role="alert"]')).not.toBeNull();
  expect(prepared).not.toHaveBeenCalled();
  dispose();
  root.remove();
});
