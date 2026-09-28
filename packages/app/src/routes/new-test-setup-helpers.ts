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
  return accounts
    .filter(
      (item) =>
        !item.fixture.revokedAt &&
        Boolean(item.fixture.reference) &&
        [
          ...(item.fixture.origins ?? []),
          ...(item.target.startUrl ? [item.target.startUrl] : []),
        ].some((origin) => bare(origin) === host),
    )
    .map((item) => ({
      reference: item.fixture.reference,
      name: accountDisplayName(item),
      targetId: item.fixture.targetId,
    }));
}
