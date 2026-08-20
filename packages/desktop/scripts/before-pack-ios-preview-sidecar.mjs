import { bundleIosPreviewSidecar } from "./bundle-ios-preview-sidecar.mjs";
import { macTargetArch } from "./mac-target-arch.mjs";

/**
 * Rebuild the exact sidecar for the macOS artifact electron-builder is about
 * to sign. A resource from another architecture would pass file-copy checks
 * but leave one Mach-O slice unsigned, so fail closed instead.
 */
export default async function beforePack(context) {
  if (context.electronPlatformName !== "darwin") return;
  await bundleIosPreviewSidecar({ arch: macTargetArch(context.arch) });
}
