/** Pure action identifiers, shared with browser-safe recipe validation. */
export const ACTION_IDS = [
  "update-last-alpha",
  "install-last-alpha",
  "reinstall-last-alpha",
  "update-last-prod",
  "install-last-prod",
  "login-google",
  "login-email",
  "login-x",
  "logout",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export function isActionId(id: string): id is ActionId {
  return (ACTION_IDS as readonly string[]).includes(id);
}
