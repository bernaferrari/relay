import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackagedIosPreviewSidecar } from "../../../scripts/ios-preview-sidecar.mjs";
import { macTargetArch } from "./mac-target-arch.mjs";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(desktopRoot, "../..");

/**
 * Electron Builder signs the resource after copying it. Check the final app
 * seal here, rather than comparing the pre-sign build hash to bytes that
 * macOS legitimately changed while adding the code signature.
 */
export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const arch = macTargetArch(context.arch);
  await verifyPackagedIosPreviewSidecar({ root: workspaceRoot, appPath, arch });
  console.log(`[desktop] verified signed safe iOS preview sidecar (${arch})`);
}
