import { expect, it } from "vitest";
import { runSetupProfile } from "./run-setup-profile";
const admin = {
  id: "admin-profile",
  name: "Admin browser",
  targetId: "admin-browser",
  platform: "browser",
  account: { id: "admin-fixture", name: "Admin" },
} as const;
const member = {
  ...admin,
  id: "member-profile",
  targetId: "member-browser",
  account: { id: "member-fixture", name: "Member" },
};
it("names only the unique saved setup for the current target", () => {
  expect(runSetupProfile([admin, member], "admin-browser")).toBe(admin);
  expect(runSetupProfile([admin, member], "missing-browser")).toBeUndefined();
});
it("does not infer an account when the current browser has more than one saved setup", () => {
  expect(
    runSetupProfile([admin, { ...member, targetId: admin.targetId }], admin.targetId),
  ).toBeUndefined();
});
it("keeps an explicit incompatible or missing profile for admission to block", () => {
  expect(runSetupProfile([admin, member], admin.targetId, member.id)).toBe(member);
  expect(runSetupProfile([admin, member], admin.targetId, "missing-profile")).toBeUndefined();
});
