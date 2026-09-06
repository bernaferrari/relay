import { describe, expect, it } from "vitest";
import { operationDefinition } from "@relay/protocol";
import { compileTestStarts, parsePairedConfigurationWorkspace } from "./paired-configuration";
import { profileTargetsFromStarts } from "./start-owned-test-run";

const workspace = parsePairedConfigurationWorkspace(
  JSON.stringify({
    schemaVersion: 1,
    updatedAt: 1,
    rows: [
      {
        id: "admin",
        name: "Admin",
        browserId: "browser-1",
        browserName: "Chrome",
        engine: "chromium",
        accountId: "acct-admin",
        accountName: "Admin",
        accountRevision: "4",
      },
      {
        id: "member",
        name: "Member",
        browserId: "browser-1",
        browserName: "Chrome",
        engine: "chromium",
        accountId: "acct-member",
        accountName: "Member",
        accountRevision: "7",
      },
      {
        id: "signed-out",
        name: "Signed out",
        browserId: "browser-2",
        browserName: "Chrome",
        engine: "chromium",
        signedOutAttested: true,
      },
    ],
  }),
);

const profiles = [
  { id: "profile-admin", targetId: "browser-1", account: { id: "acct-admin" } },
  { id: "profile-member", targetId: "browser-1", account: { id: "acct-member" } },
  { id: "profile-out", targetId: "browser-2" },
] as const;

describe("handoff identity", () => {
  it.each([
    {
      name: "Admin",
      index: 0,
      account: { kind: "fixture" as const, accountId: "acct-admin", accountRevision: "4" },
      engine: "chromium",
    },
    {
      name: "Member",
      index: 1,
      account: { kind: "fixture" as const, accountId: "acct-member", accountRevision: "7" },
      engine: "chromium",
    },
    {
      name: "signed-out",
      index: 2,
      account: { kind: "signed-out" as const, attested: true as const },
      engine: "chromium",
    },
  ])(
    "keeps $name account and engine through compile, combine body, and protocol parse",
    ({ index, account, engine }) => {
      const starts = compileTestStarts({
        testId: "checkout",
        appMapId: "app-1",
        workspace,
        profiles,
      });
      expect(starts[0]).not.toEqual(starts[1]);
      const start = starts[index]!;
      expect(start.account).toEqual(account);
      expect(start.engine).toEqual(engine);

      const targets = profileTargetsFromStarts(starts);
      expect(targets[index]?.account).toEqual(account);
      expect(targets[index]?.engine).toEqual(engine);

      const parsed = operationDefinition("job.combine.start").input.parse({
        appMapId: "app-1",
        testId: "checkout",
        executionMode: "all",
        profileTargets: targets,
      });
      expect(parsed.profileTargets?.[index]?.account).toEqual(account);
      expect(parsed.profileTargets?.[index]?.engine).toEqual(engine);
    },
  );
});
