import type { Page } from "playwright-core";
import type { StepTarget } from "@relay/protocol";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RecipeStep } from "../recipe/recipes.js";
import type { Device } from "../device/device.js";
import type { RecipeStepContext } from "../recipe/recipe-runner-context.js";
import { browserSessionForDevice } from "../browser/browser-live-handles.js";
import { activePage } from "../browser/browser-target.js";
import { locatorFor } from "../browser/browser-target-locator.js";
import { browserUploadLocatorInput } from "../browser/browser-live-controls.js";
import { runBrowserMutationAdmission } from "../browser/browser-mutation-admission.js";
import { browserAccountSchedulingKey } from "../browser/browser-account-lane.js";

export async function runDownloadStep(
  device: Device,
  step: Extract<RecipeStep, { kind: "download" }>,
  ctx: RecipeStepContext,
): Promise<void> {
  const session = browserSessionForDevice(device);
  if (!session) throw new Error("download requires a browser target");
  if (!ctx.job?.runDir) throw new Error("download requires an evidence-backed Run");
  const root = await realpath(ctx.job.runDir);
  const relativeFile = step.file;
  if (isAbsolute(relativeFile) || relativeFile.split(/[\\/]/).some((part) => part === ".."))
    throw new Error("download: use a relative output name");
  const file = resolve(root, "artifacts", "downloads", relativeFile);
  await mkdir(dirname(file), { recursive: true });
  const parent = await realpath(dirname(file));
  const local = relative(root, parent);
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    throw new Error("download: destination is outside its Run");
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
    data: { stepId: step.id, file: step.file, path: relative(root, file) },
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
