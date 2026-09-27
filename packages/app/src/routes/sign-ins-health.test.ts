import { describe, expect, it } from "vitest";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import {
  accountHealthState,
  concurrentAccountCopy,
  lanesForAccount,
  liveSignIns,
  probedAccountIdentity,
  readySignIns,
  revokedSignIns,
} from "./sign-ins-health";

const now = Date.now();
const live: ProductBrowserAccount = {
  target: { id: "grok-com", name: "Grok.com" },
  fixture: {
    id: "7189423f-193e-45ed-b674-154505cc5107",
    reference: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
    revision: 1,
    targetId: "grok-com",
    name: "SuperGrok lab signed-in",
    origins: ["https://grok.com"],
    cookieCount: 33,
    createdAt: now,
    health: { status: "ready", checkedAt: now, signedIn: true },
  },
};
const revoked: ProductBrowserAccount = {
  target: { id: "grok-com", name: "Grok.com" },
  fixture: {
    id: "addeb648-90e6-43fe-9a6a-6e2c11d8bd09",
    reference: "authfx:addeb648-90e6-43fe-9a6a-6e2c11d8bd09:1",
    revision: 1,
    targetId: "grok-com",
    name: "P2.1 lab A",
    origins: ["https://grok.com"],
    cookieCount: 1,
    createdAt: now,
    revokedAt: now,
    health: { status: "revoked", checkedAt: now },
  },
};

describe("Sign-ins health", () => {
  it("hides revoked lab accounts from the live set", () => {
    expect(liveSignIns([live, revoked])).toEqual([live]);
    expect(revokedSignIns([live, revoked])).toEqual([revoked]);
    expect(accountHealthState(revoked.fixture)).toBe("revoked");
  });

  it("does not treat needs-relogin as a live SuperGrok account", () => {
    const stale: ProductBrowserAccount = {
      ...live,
      fixture: {
        ...live.fixture,
        health: { status: "needs-relogin", checkedAt: now, signedIn: false },
      },
    };
    expect(readySignIns([live, stale, revoked])).toEqual([live]);
    expect(concurrentAccountCopy(readySignIns([live, stale]).length)).toContain("One live account");
    expect(
      probedAccountIdentity({
        ...live.fixture,
        health: { ...live.fixture.health!, identity: "Bernardo Ferrari" },
      }),
    ).toBe("Bernardo Ferrari");
    expect(probedAccountIdentity(live.fixture)).toBeUndefined();
  });

  it("says one live account cannot be a 3-account Plan", () => {
    expect(concurrentAccountCopy(1)).toContain("One live account");
    expect(concurrentAccountCopy(1)).toContain("another saved sign-in");
    expect(concurrentAccountCopy(3)).toContain(
      "3 live accounts can run the same Test concurrently",
    );
  });

  it("binds a fixture to its saved Lane without exposing secrets", () => {
    const lanes = lanesForAccount(live, [
      { id: "grok-daily", targetId: "grok-com", kind: "signed-out" },
      {
        id: "grok-lab",
        targetId: "grok-com",
        kind: "fixture",
        reference: live.fixture.reference,
      },
    ]);
    expect(lanes.map((lane) => lane.id)).toEqual(["grok-lab"]);
  });
});
