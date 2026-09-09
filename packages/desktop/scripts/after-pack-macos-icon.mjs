import { compileMacosIcon } from "./compile-macos-icon.mjs";

export default async function afterPack(context) {
  if (context.electronPlatformName === "darwin") {
    await compileMacosIcon(context.appOutDir, context.packager.projectDir);
  }
}
