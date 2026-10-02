import { expect, it } from "vitest";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import { websiteAccounts } from "./new-test-setup-helpers";

function account(id: string, createdAt: number, browser = "Chrome"): ProductBrowserAccount {
  return {
    target: { id: `browser-${id}`, name: browser, startUrl: "https://shop.example/" },
    fixture: {
      id,
      reference: `authfx:${id}:1`,
      targetId: `browser-${id}`,
      revision: 1,
      name: "Member",
      createdAt,
      cookieCount: 1,
      origins: ["https://shop.example"],
    },
  };
}

it("distinguishes saved logins without losing their identity and puts the newest first", () => {
  const accounts = [account("old", 1), account("firefox", 2, "Firefox"), account("new", 3)];
  const choices = websiteAccounts(accounts, "https://www.shop.example/settings");
  expect(choices).toEqual([
    { name: "Member · Chrome · Latest", reference: "authfx:new:1", targetId: "browser-new" },
    { name: "Member · Firefox", reference: "authfx:firefox:1", targetId: "browser-firefox" },
    {
      name: "Member · Chrome · Earlier login 1",
      reference: "authfx:old:1",
      targetId: "browser-old",
    },
  ]);
  expect(accounts.map((item) => item.fixture.id)).toEqual(["old", "firefox", "new"]);
});

it("excludes revoked and unrelated logins and keeps an unambiguous account name short", () => {
  const revoked = account("revoked", 2);
  revoked.fixture.revokedAt = 3;
  const unrelated = account("other-site", 3);
  unrelated.target.startUrl = "https://other.example";
  unrelated.fixture.origins = ["https://other.example"];
  expect(
    websiteAccounts([account("member", 1), revoked, unrelated], "https://shop.example/"),
  ).toEqual([{ name: "Member", reference: "authfx:member:1", targetId: "browser-member" }]);
});
