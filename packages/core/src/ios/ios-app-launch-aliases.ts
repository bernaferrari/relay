const BUNDLE_ALIASES: Record<string, string> = {
  settings: "com.apple.Preferences",
  safari: "com.apple.mobilesafari",
  testflight: "com.apple.TestFlight",
  "test flight": "com.apple.TestFlight",
  preferences: "com.apple.Preferences",
  "com.apple.preferences": "com.apple.Preferences",
  springboard: "com.apple.springboard",
  home: "com.apple.springboard",
};

/** Register a product-specific friendly iOS app name. Core only owns system aliases. */
export function registerIosLaunchBundleAlias(alias: string, bundleId: string): () => void {
  const key = alias.trim().toLocaleLowerCase();
  const bundle = bundleId.trim();
  if (!key || !bundle.includes(".")) {
    throw new Error("iOS launch alias requires a non-empty name and bundle id");
  }
  const prior = BUNDLE_ALIASES[key];
  BUNDLE_ALIASES[key] = bundle;
  return () => {
    if (prior === undefined) delete BUNDLE_ALIASES[key];
    else BUNDLE_ALIASES[key] = prior;
  };
}

export function resolveIosLaunchBundleId(app: string): string {
  const trimmed = app.trim();
  if (!trimmed) throw new Error("iOS launch requires an app name or bundle id");
  const alias = BUNDLE_ALIASES[trimmed.toLocaleLowerCase()];
  if (alias) return alias;
  if (trimmed.includes(".")) return trimmed;
  throw new Error(
    `“${trimmed}” is not a known iOS app. Use a bundle id such as com.apple.Preferences.`,
  );
}
