import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  LaunchOptions,
} from "playwright-core";
import { chromium, firefox, webkit } from "playwright-core";
import type { BrowserCaseProfile, BrowserEngine, TargetDefinition } from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { browserExecutable, browserProfileDir } from "./targets.js";
import { assertSupportedBrowserCaseProfile } from "./browser-profile-support.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";

export type BrowserContextPurpose = "authoring" | "proof";

export type BrowserContextHandle = Readonly<{
  context: BrowserContext;
  profile: BrowserCaseProfile;
  purpose: BrowserContextPurpose;
  close: () => Promise<void>;
}>;

export type BrowserContextFactory = Readonly<{
  profile: BrowserCaseProfile;
  openAuthoring: (options?: BrowserContextOpenOptions) => Promise<BrowserContextHandle>;
  openProof: (
    profile?: BrowserCaseProfile,
    options?: BrowserContextOpenOptions,
  ) => Promise<BrowserContextHandle>;
}>;

export type BrowserContextOpenOptions = {
  headless?: boolean;
  recordVideoDir?: string;
  profile?: BrowserCaseProfile;
};

const BROWSER_TYPES: Record<BrowserEngine, BrowserType> = { chromium, firefox, webkit };

export function browserContextOptionsForProfile(
  profile: BrowserCaseProfile,
  options: BrowserContextOpenOptions,
): BrowserContextOptions {
  return {
    viewport: profile.viewport,
    ...(profile.screen === undefined ? {} : { screen: profile.screen }),
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.mobile,
    hasTouch: profile.touch,
    ...(profile.userAgent === undefined ? {} : { userAgent: profile.userAgent }),
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    colorScheme: profile.colorScheme,
    reducedMotion: profile.reducedMotion,
    offline: profile.offline,
    acceptDownloads: true,
    permissions: [...profile.permissions],
    ...(profile.geolocation === undefined ? {} : { geolocation: profile.geolocation }),
    ...(options.recordVideoDir
      ? { recordVideo: { dir: options.recordVideoDir, size: profile.viewport } }
      : {}),
  };
}

function launchOptions(
  target: TargetDefinition,
  profile: BrowserCaseProfile,
  options: BrowserContextOpenOptions,
): LaunchOptions {
  const browserOptions: LaunchOptions = {
    headless: options.headless ?? target.browser?.headless ?? false,
  };
  if (profile.channel !== undefined) browserOptions.channel = profile.channel;
  // The existing executable allow-list is Chromium-specific. Firefox and
  // WebKit must use their requested Playwright engines and never fall back to
  // Chromium when a profile asks for another engine.
  // A branded channel selects its own executable. Passing the managed Chrome
  // path alongside a channel would make the host choice ambiguous.
  if (profile.engine === "chromium" && profile.channel === undefined) {
    browserOptions.executablePath = browserExecutable(target);
  }
  return browserOptions;
}

async function closeBrowserAndContext(browser: Browser, context: BrowserContext): Promise<void> {
  let firstError: unknown;
  try {
    await context.close();
  } catch (error) {
    firstError = error;
  }
  try {
    await browser.close();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}

function idempotentClose(operation: () => Promise<void>): () => Promise<void> {
  let closed: Promise<void> | undefined;
  return () => {
    closed ??= operation();
    return closed;
  };
}

async function openPersistentAuthoringContext(
  target: TargetDefinition,
  profile: BrowserCaseProfile,
  options: BrowserContextOpenOptions,
): Promise<BrowserContextHandle> {
  const browserType = BROWSER_TYPES[profile.engine];
  const contextOptionsValue = browserContextOptionsForProfile(profile, options);
  const context = await browserType.launchPersistentContext(browserProfileDir(target.id), {
    ...launchOptions(target, profile, options),
    ...contextOptionsValue,
  });
  return {
    context,
    profile,
    purpose: "authoring",
    close: idempotentClose(() => context.close()),
  };
}

async function openFreshProofContext(
  target: TargetDefinition,
  profile: BrowserCaseProfile,
  options: BrowserContextOpenOptions,
): Promise<BrowserContextHandle> {
  const browser = await BROWSER_TYPES[profile.engine].launch(
    launchOptions(target, profile, options),
  );
  try {
    const context = await browser.newContext(browserContextOptionsForProfile(profile, options));
    return {
      context,
      profile,
      purpose: "proof",
      close: idempotentClose(() => closeBrowserAndContext(browser, context)),
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

/** Build an explicit factory for one managed target. The profile is compiled
 * once and each proof call receives a separate browser process/context pair;
 * authoring remains the sole persistent-profile path. */
export function createBrowserContextFactory(target: TargetDefinition): BrowserContextFactory {
  const profile = browserCaseProfileForTarget(target);
  return {
    profile,
    openAuthoring: async (options = {}) => {
      const authoringProfile = options.profile
        ? compileBrowserEnvironment(options.profile)
        : profile;
      assertSupportedBrowserCaseProfile(authoringProfile);
      if (authoringProfile.engine !== profile.engine) {
        throw new Error(
          `browser authoring engine ${authoringProfile.engine} does not match target engine ${profile.engine}`,
        );
      }
      return await openPersistentAuthoringContext(target, authoringProfile, options);
    },
    openProof: async (proofProfile = profile, options = {}) => {
      const frozen = compileBrowserEnvironment(proofProfile);
      assertSupportedBrowserCaseProfile(frozen);
      if (frozen.engine !== profile.engine) {
        // A target is an engine host. Selecting another engine requires a
        // different target/host rather than a silent fallback.
        throw new Error(
          `browser proof engine ${frozen.engine} does not match target engine ${profile.engine}`,
        );
      }
      return await openFreshProofContext(target, frozen, options);
    },
  };
}
