import type { Page } from "playwright-core";
import type { StepTarget } from "@relay/protocol";
import { open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RecipeStep } from "./recipes.js";
import type { Device } from "./device.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { browserSessionForDevice } from "./browser-live-handles.js";
import { activePage } from "./browser-target.js";
import { locatorFor } from "./browser-target-locator.js";
import { browserUploadLocatorInput } from "./browser-live-controls.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";

export async function runDownloadStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "download" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const session = browserSessionForDevice(device);
  if (!session) throw new Error("download requires a browser target");
  const root = await realpath(findWorkspaceRoot());
  const file = resolve(root, step.file);
  const parent = await realpath(dirname(file));
  const local = relative(root, parent);
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    throw new Error("download: destination must be inside the workspace");
  // Reserve without clobbering an old result or following a destination symlink.
  const handle = await open(file, "wx", 0o600);
  await handle.close();
  try {
    await runBrowserMutationAdmission(
      browserAccountSchedulingKey(
        session.targetId,
        session.profile.authenticationFixtureId,
        session.unsignedLaneId,
      ),
      async () => {
        const page = await activePage(session);
        await downloadFromPage(page, step.target, file);
      },
    );
  } catch (error) {
    await unlink(file);
    throw error;
  }
  const artifact = {
    kind: "download",
    capturedAt: Date.now(),
    data: { stepId: step.id, file: step.file },
  };
  ctx.job?.artifacts.push(artifact);
  ctx.artifacts?.push(artifact);
  ctx.log(`download: saved ${step.file}`);
}

export async function downloadFromPage(
  page: Page,
  target: StepTarget,
  file: string,
): Promise<void> {
  const control = await locatorFor(page, browserUploadLocatorInput(target));
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    control.click(),
  ]);
  await download.saveAs(file);
  const error = await download.failure();
  if (error) throw new Error(`download failed: ${error}`);
}
