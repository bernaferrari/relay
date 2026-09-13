import type { StepTarget } from "@relay/protocol";
import type { Locator, Page } from "playwright-core";
import { currentTargetContext } from "./target-context.js";
import { activePage, browserProofSessionForTarget, type BrowserSession } from "./browser-target.js";
import { locatorFor } from "./browser-target-locator.js";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { browserSessionForDevice } from "./browser-live-handles.js";
import type { Device } from "./device.js";

async function liveBrowserSession(device?: Device): Promise<BrowserSession> {
  const bound = device ? browserSessionForDevice(device) : undefined;
  if (bound) return bound;
  const context = currentTargetContext();
  if (context.kind !== "browser") throw new Error("This control requires a browser target");
  return browserProofSessionForTarget(
    context.targetId,
    context.kind === "browser" ? undefined : undefined,
  );
}

function mutationLane(session: BrowserSession): string {
  return browserAccountSchedulingKey(session.targetId, session.profile.authenticationFixtureId);
}

/** Playwright context.setOffline on the live proof/authoring context. */
export async function applyBrowserOffline(offline: boolean, device?: Device): Promise<void> {
  const session = await liveBrowserSession(device);
  await runBrowserMutationAdmission(mutationLane(session), () =>
    session.context.setOffline(offline),
  );
}

export type BrowserFileChooser = { setFiles(files: string | readonly string[]): Promise<void> };

export type BrowserUploadIo = {
  tryIdentifierInput?: (identifier: string) => Promise<boolean>;
  tryLabelInput?: (label: string) => Promise<boolean>;
  tryHiddenInput: () => Promise<boolean>;
  clickSemanticTarget?: (target: StepTarget) => Promise<void>;
  waitForFileChooser: () => Promise<BrowserFileChooser | undefined>;
};

function quotedSelectorField(field: "id" | "label", value: string): string {
  return `${field}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function browserUploadLocatorInput(target: StepTarget): { selector: string } {
  const identifier = target.identifier?.trim();
  if (identifier) return { selector: quotedSelectorField("id", identifier) };
  const label = target.label?.trim();
  if (label) return { selector: quotedSelectorField("label", label) };
  throw new Error("upload target requires identifier or label");
}

/** Arm a file chooser before clicking a menuitem, or set files on a hidden input. */
export async function fulfillBrowserUpload(
  file: string,
  target: StepTarget | undefined,
  io: BrowserUploadIo,
): Promise<void> {
  const identifier = target?.identifier?.trim();
  const label = target?.label?.trim();
  if (identifier && io.tryIdentifierInput && (await io.tryIdentifierInput(identifier))) return;
  if (label && io.tryLabelInput && (await io.tryLabelInput(label))) return;
  if (target && (identifier || label) && io.clickSemanticTarget) {
    const chooserPromise = io.waitForFileChooser();
    await io.clickSemanticTarget(target);
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(file);
      return;
    }
    if (await io.tryHiddenInput()) return;
    throw new Error("upload: file chooser did not open after clicking the attach control");
  }
  if (await io.tryHiddenInput()) return;
  const chooser = await io.waitForFileChooser();
  if (chooser) {
    await chooser.setFiles(file);
    return;
  }
  throw new Error("upload: no file input or file chooser appeared");
}

async function setInputFilesQuietly(locator: Locator, file: string): Promise<boolean> {
  try {
    await locator.setInputFiles(file);
    return true;
  } catch {
    return false;
  }
}

export async function uploadBrowserFile(
  file: string,
  target?: StepTarget,
  device?: Device,
): Promise<void> {
  const session = await liveBrowserSession(device);
  const page = await activePage(session);
  await runBrowserMutationAdmission(mutationLane(session), () =>
    attachFilesOnPage(page, file, target),
  );
}

export async function attachFilesOnPage(
  page: Page,
  file: string,
  target?: StepTarget,
): Promise<void> {
  await fulfillBrowserUpload(file, target, {
    tryIdentifierInput: (id) =>
      setInputFilesQuietly(
        page.locator(
          `[id=${JSON.stringify(id)}], [name=${JSON.stringify(id)}], [data-testid=${JSON.stringify(id)}]`,
        ),
        file,
      ),
    tryLabelInput: (label) =>
      setInputFilesQuietly(page.getByLabel(label, { exact: false }), file),
    tryHiddenInput: () =>
      setInputFilesQuietly(page.locator('input[type="file"]').first(), file),
    clickSemanticTarget: async (stepTarget) => {
      const locator = await locatorFor(page, browserUploadLocatorInput(stepTarget));
      await locator.click();
    },
    waitForFileChooser: async () => {
      try {
        return await page.waitForEvent("filechooser", { timeout: 8_000 });
      } catch {
        return undefined;
      }
    },
  });
}
