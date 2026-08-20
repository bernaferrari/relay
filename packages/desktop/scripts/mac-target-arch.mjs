// electron-builder's Arch enum is numeric at hook time. Accept the textual
// forms as well so this stays clear if the builder exposes them in a future
// release.
const electronBuilderArch = new Map([
  [1, "x64"],
  [3, "arm64"],
  ["x64", "x64"],
  ["arm64", "arm64"],
]);

export function macTargetArch(value) {
  const arch = electronBuilderArch.get(value);
  if (arch) return arch;
  throw new Error(
    "Relay packages the safe iOS preview sidecar as one signed target-native Mach-O. " +
      "Build separate --x64 or --arm64 macOS artifacts; universal sidecar packaging is not supported.",
  );
}
