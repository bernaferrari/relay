import {
  accountFixtureIdsFromListed,
  accountReloginFindingsReport,
  bindRequestedBrowserIdentity,
  claimedFixtureStartBlocker,
  listBrowserAuthenticationFixtures,
  type RequestedBrowserAccount,
  type SavedBrowserIdentity,
} from "@relay/core";
import { HttpError } from "./http.js";

export async function assertAppMapTestBrowserIdentity(input: {
  projectId: string;
  targetId: string;
  platform: "android" | "browser" | "ios";
  account?: RequestedBrowserAccount;
  engine?: string;
  savedBrowser: SavedBrowserIdentity | undefined;
}): Promise<string | undefined> {
  if (input.account || input.engine) {
    const listed = await listBrowserAuthenticationFixtures({
      projectId: input.projectId,
      targetId: input.targetId,
    });
    const bound = bindRequestedBrowserIdentity({
      requested: {
        ...(input.engine ? { engine: input.engine } : {}),
        ...(input.account ? { account: input.account } : {}),
      },
      saved: {
        ...(input.savedBrowser?.engine ? { engine: input.savedBrowser.engine } : {}),
        ...(input.savedBrowser?.authenticationFixtureId
          ? { authenticationFixtureId: input.savedBrowser.authenticationFixtureId }
          : {}),
      },
      platform: input.platform,
      accountFixtureIds: accountFixtureIdsFromListed(listed),
    });
    if (bound.status === "blocked") {
      throw new HttpError(409, bound.reason, {
        code: "REQUESTED_ACCOUNT_MISMATCH",
        recovery:
          "Use the exact saved account fixture revision, or capture a matching runtime profile before running.",
      });
    }
  }
  const savedFixtureReference = input.savedBrowser?.authenticationFixtureId?.trim();
  const accountBlocker = await claimedFixtureStartBlocker({
    projectId: input.projectId,
    targetId: input.targetId,
    ...(input.account ? { account: input.account } : {}),
    ...(savedFixtureReference ? { savedFixtureReference } : {}),
  });
  if (accountBlocker) {
    throw new HttpError(409, accountBlocker, {
      code: "ACCOUNT_NEEDS_RELOGIN",
      recovery: "Open Sign-ins, complete OAuth, then Refresh.",
      findings: accountReloginFindingsReport({ detail: accountBlocker }),
    });
  }
  return savedFixtureReference;
}
