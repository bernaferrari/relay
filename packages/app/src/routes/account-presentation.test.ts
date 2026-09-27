import { describe, expect, it } from "vitest";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import {
  accountDisplayName,
  accountLastUsedAt,
  accountProvider,
  accountSiteHost,
  accountStatus,
  accountStatusLabel,
} from "./account-presentation";

function account(
  fixture: Partial<ProductBrowserAccount["fixture"]> = {},
  target: Partial<ProductBrowserAccount["target"]> = {},
): ProductBrowserAccount {
  return {
    target: { id: "browser", name: "Browser", ...target },
    fixture: {
      id: "fx",
      reference: "authfx:fx:1",
      revision: 1,
      targetId: "browser",
      name: "Staging buyer",
      origins: ["https://shop.example"],
      cookieCount: 1,
      createdAt: 1,
      ...fixture,
    },
  };
}

describe("account presentation", () => {
  it("names the website from the browser start page, else a non-provider cookie origin", () => {
    expect(accountSiteHost(account({}, { startUrl: "https://www.grok.com/chat" }))).toBe(
      "grok.com",
    );
    expect(
      accountSiteHost(
        account({ origins: ["https://accounts.google.com", "https://shop.example"] }),
      ),
    ).toBe("shop.example");
  });

  it("reports a sign-in method only when saved data shows one", () => {
    expect(accountProvider(account())).toBeUndefined();
    expect(
      accountProvider(
        account({ origins: ["https://shop.example", "https://accounts.google.com"] }),
      ),
    ).toBe("Google");
    expect(accountProvider(account({ name: "grok-auth-x" }))).toBe("X");
    expect(accountProvider(account({ name: "Gmail tester" }))).toBe("Google");
    expect(accountProvider(account({ name: "Email member" }))).toBe("Email");
    expect(accountProvider(account({ name: "Max buyer" }))).toBeUndefined();
  });

  it("maps health to three plain statuses", () => {
    expect(accountStatusLabel(accountStatus(account()))).toBe("Signed in");
    expect(
      accountStatusLabel(
        accountStatus(account({ health: { status: "expired", checkedAt: 1 } as never })),
      ),
    ).toBe("Needs sign-in");
    expect(accountStatusLabel(accountStatus(account({ revokedAt: 1 })))).toBe("Revoked");
  });

  it("prefers the probed identity as the name", () => {
    expect(accountDisplayName(account())).toBe("Staging buyer");
    expect(
      accountDisplayName(
        account({
          health: { status: "ready", checkedAt: 1, identity: "me@shop.example" } as never,
        }),
      ),
    ).toBe("me@shop.example");
  });

  it("finds the last run made as the account by id or reference", () => {
    const runs = [
      { queuedAt: 10, finishedAt: 20, executionIdentity: { accountId: "fx" } },
      { queuedAt: 30, executionIdentity: { accountId: "authfx:fx:1" } },
      { queuedAt: 50, executionIdentity: { accountId: "someone-else" } },
      { queuedAt: 60 },
    ];
    expect(accountLastUsedAt(account(), runs)).toBe(30);
  });
});
