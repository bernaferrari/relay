import type { AppIdentityPolicy } from "../app/app-identity-policy.js";
import type { SnapshotNode } from "../device/device.js";

const COMPOSER_ROLE = /^(?:textbox|textarea|searchbox)$/u;
const ROUTE_ANNOUNCER = /__next-route-announcer__/iu;
const TYPEAHEAD_ROLE = /^(?:option|listbox|listitem)$/u;

function nodeRole(node: SnapshotNode): string {
  return (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
}

function compactCopy(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

export function typedComposerValues(nodes: readonly SnapshotNode[]): Set<string> {
  const values = new Set<string>();
  for (const node of nodes) {
    if (!COMPOSER_ROLE.test(nodeRole(node))) continue;
    const value = compactCopy(node.value).toLocaleLowerCase("en-US");
    if (value) values.add(value);
  }
  return values;
}

/** Typeahead rows, Next.js route announcer, and suggestion fragments while typing. */
export function isTypeaheadOrAnnouncerNode(
  node: SnapshotNode,
  typedValues: ReadonlySet<string>,
  policy?: AppIdentityPolicy,
): boolean {
  if (ROUTE_ANNOUNCER.test(node.identifier ?? "")) return true;
  const role = nodeRole(node);
  if (TYPEAHEAD_ROLE.test(role)) return true;
  if (role !== "text" || typedValues.size === 0 || !policy?.composer) return false;
  const label = compactCopy(node.label).toLocaleLowerCase("en-US");
  return Boolean(label) && !policy.composer.typeaheadChromeLabel?.test(label);
}
