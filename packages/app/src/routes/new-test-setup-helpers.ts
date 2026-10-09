import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import { accountDisplayName } from "./account-presentation";
import { websiteHost, type WebsiteAccount } from "./new-test-quick-start";

export const NEW_TEST_DRAFT_KEY = "newTestDraft";

export function friendlyPreviewIssue(message: string): string {
  if (/view only|locked|unlock/iu.test(message)) {
    return "Keep the Device connected and unlocked, then reconnect.";
  }
  if (
    /packet|transport|codec|decode|base64|operation|targetid|502|503|fetch|gateway/iu.test(message)
  ) {
    return "Relay could not show the live view. Reconnect, then try again.";
  }
  return message;
}

export async function readNewTestDraft(platform: {
  storage: { get(key: string): string | null | Promise<string | null> };
}): Promise<{
  appId?: string;
  targetId?: string;
}> {
  try {
    const stored = await Promise.resolve(platform.storage.get(NEW_TEST_DRAFT_KEY));
    const parsed = JSON.parse(stored ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    return {
      ...(typeof value.appId === "string" ? { appId: value.appId } : {}),
      ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    };
  } catch {
    return {};
  }
}

/** Saved logins, not revoked, whose cookies cover this website. */
export function websiteAccounts(
  accounts: readonly ProductBrowserAccount[],
  url: string,
): WebsiteAccount[] {
  const bare = (value: string) => websiteHost(value).replace(/^www\./, "");
  const host = bare(url);
  const matching = accounts
    .filter(
      (item) =>
        !item.fixture.revokedAt &&
        Boolean(item.fixture.reference) &&
        [
          ...(item.fixture.origins ?? []),
          ...(item.target.startUrl ? [item.target.startUrl] : []),
        ].some((origin) => bare(origin) === host),
    )
    .sort((left, right) => right.fixture.createdAt - left.fixture.createdAt);
  return matching.map((item) => {
    const name = accountDisplayName(item);
    const sameName = matching.filter((other) => accountDisplayName(other) === name);
    const sameBrowser = sameName.filter((other) => other.target.name === item.target.name);
    const version = sameBrowser.indexOf(item);
    const label = sameName.length < 2 ? name : `${name} · ${item.target.name}`;
    return {
      reference: item.fixture.reference,
      name:
        sameBrowser.length < 2
          ? label
          : `${label} · ${version === 0 ? "Latest" : `Earlier login ${version}`}`,
      targetId: item.fixture.targetId,
    };
  });
}

/** The one reason recording can't start yet, in the order a person resolves them. */
export function recordingStartHint(state: {
  app: boolean;
  creatingApp: boolean;
  inputFailed: boolean;
  previewProblem: boolean;
  checkingInput: boolean;
  reconnecting: boolean;
  target: boolean;
  starting: boolean;
  appNotOpened: boolean;
}): string {
  if (!state.app) return "Choose an app";
  if (state.creatingApp) return "Finish creating your app";
  if (state.inputFailed) return "Check the last interaction before recording";
  if (state.previewProblem) return "Reconnect the preview before recording";
  if (state.checkingInput) return "Checking the last interaction…";
  if (state.reconnecting) return "Reconnecting preview…";
  if (!state.target) return "Choose a Device or Browser";
  if (state.starting) return "Starting…";
  if (state.appNotOpened) return "Open the selected app first";
  return "Start recording";
}
