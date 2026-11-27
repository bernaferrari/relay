import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type RelayExtensionModule = {
  registerRelayExtension?: () => unknown;
  default?: () => unknown;
};

/** Extension modules are explicit host configuration, never ambient core behavior. */
export function relayExtensionModuleSpecifiers(
  value: string | undefined = process.env.RELAY_EXTENSION_MODULES,
): string[] {
  return (value ?? "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean);
}

function extensionImportSpecifier(specifier: string, cwd: string): string {
  if (specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(cwd, specifier)).href;
  }
  return specifier;
}

/** Load modules that export registerRelayExtension (or a default registration function). */
export async function loadRelayExtensionModules(
  specifiers: readonly string[],
  options: { cwd?: string } = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  for (const specifier of specifiers) {
    const importSpecifier = extensionImportSpecifier(specifier, cwd);
    let module: RelayExtensionModule;
    try {
      module = (await import(importSpecifier)) as RelayExtensionModule;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load Relay extension ${specifier}: ${message}`);
    }
    const register = module.registerRelayExtension ?? module.default;
    if (typeof register !== "function") {
      throw new Error(
        `Relay extension ${specifier} must export registerRelayExtension() or a default registration function`,
      );
    }
    await register();
  }
}

export async function loadRelayExtensionsFromEnvironment(): Promise<void> {
  await loadRelayExtensionModules(relayExtensionModuleSpecifiers());
}
