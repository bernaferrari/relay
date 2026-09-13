import type { SnapshotNode } from "./device.js";

const COMPOSER_ROLE = /^(?:textbox|textarea|searchbox)$/u;
const ROUTE_ANNOUNCER = /__next-route-announcer__/iu;
const TYPEAHEAD_ROLE = /^(?:option|listbox|listitem)$/u;
const CHROME_TEXT_LABEL = /^(?:explore\?|fast|imagine|chat|auto|expert|heavy|build)$/iu;

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
): boolean {
  if (ROUTE_ANNOUNCER.test(node.identifier ?? "")) return true;
  const role = nodeRole(node);
  if (TYPEAHEAD_ROLE.test(role)) return true;
  if (role !== "text" || typedValues.size === 0) return false;
  const label = compactCopy(node.label).toLocaleLowerCase("en-US");
  return Boolean(label) && !CHROME_TEXT_LABEL.test(label);
}
