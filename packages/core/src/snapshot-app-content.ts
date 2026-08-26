/**
 * Which snapshot nodes belong to the app under test.
 *
 * Two platform facts stop a raw iOS tree from reading as "this screen's
 * controls", and a locale sweep that trusts either one describes the wrong UI:
 *
 * 1. The software keyboard is presented inside the app's own accessibility
 *    hierarchy, so its keys and typing predictions look like app controls. They
 *    follow the system keyboard language rather than the app's, so a locale
 *    comparison reads every one of them as untranslated.
 * 2. XCTest reports `hittable:false` for SwiftUI cells. The only actionable
 *    ancestor left is the application frame itself, so every row on the screen
 *    resolves to the same anchor and collapses into a single control.
 *
 * Both are shapes, not vocabulary: nothing here names an app or a language.
 */
import type { SnapshotNode } from "./device.js";

/**
 * Containers the system input stack presents next to the keyboard. These carry
 * their own identifiers rather than sitting under the `Keyboard` element, so
 * the subtree walk below needs them as extra roots.
 */
export const SYSTEM_INPUT_IDENTIFIER =
  /^(?:systeminputassistantview|centerpageview|leftbuttonbar|rightbuttonbar|assistant(?:paste:forevent:|undo|redo))$/iu;

function childIndexes(nodes: readonly SnapshotNode[]): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.index === undefined || node.parentIndex === undefined) continue;
    const siblings = children.get(node.parentIndex) ?? [];
    siblings.push(node.index);
    children.set(node.parentIndex, siblings);
  }
  return children;
}

/**
 * Indexes of every node the software keyboard owns, including the whole subtree
 * under each keyboard root. Used to keep system input out of both screen
 * identity and the fixture control list.
 */
export function systemInputNodeIndexes(nodes: readonly SnapshotNode[]): Set<number> {
  const indexed = new Map(
    nodes.flatMap((node, offset) =>
      node.index === undefined ? [] : [[node.index, { node, offset }] as const],
    ),
  );
  const children = childIndexes(nodes);
  const roots = nodes.flatMap((node) =>
    node.index !== undefined &&
    (/^keyboard$/iu.test(node.type ?? node.role ?? "") ||
      SYSTEM_INPUT_IDENTIFIER.test(node.identifier ?? ""))
      ? [node.index]
      : [],
  );
  const ignored = new Set<number>();
  const visit = (index: number): void => {
    if (ignored.has(index)) return;
    ignored.add(index);
    for (const child of children.get(index) ?? []) visit(child);
  };
  for (const root of roots) {
    visit(root);
    // XCTest wraps the Keyboard in an unlabeled/generic container. Exclude
    // that wrapper only when the keyboard is its sole child.
    const parentIndex = indexed.get(root)?.node.parentIndex;
    const parent = parentIndex === undefined ? undefined : indexed.get(parentIndex)?.node;
    if (
      parentIndex !== undefined &&
      parent &&
      /^other$/iu.test(parent.type ?? parent.role ?? "") &&
      (children.get(parentIndex)?.length ?? 0) === 1
    ) {
      ignored.add(parentIndex);
    }
  }
  return ignored;
}

/**
 * A keyboard key or prediction candidate, wherever it sits. Trees that arrive
 * without parent links (a flattened or scoped snapshot) cannot be walked, so
 * this catches the roles directly.
 */
export function isSystemInputNode(node: SnapshotNode): boolean {
  if (SYSTEM_INPUT_IDENTIFIER.test(node.identifier ?? "")) return true;
  return /^(?:keyboard|key)$/iu.test((node.type ?? node.role ?? "").trim());
}

function isApplicationFrameRole(node: SnapshotNode): boolean {
  return /\bapplication\b|\bwindow\b/.test(
    `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase(),
  );
}

/**
 * Area of the app frame, taken from the Application or Window element that
 * declares it.
 *
 * Deliberately not "the largest rect on the tree": a scoped or single-row
 * snapshot has no frame element, and the biggest row would be mistaken for the
 * whole screen. Returning 0 means the frame is unknown, and coverage below
 * makes no claim at all.
 */
function appFrameArea(nodes: readonly SnapshotNode[]): number {
  let largest = 0;
  for (const node of nodes) {
    if (!isApplicationFrameRole(node)) continue;
    const rect = node.rect;
    if (!rect) continue;
    const area = Math.abs(rect.width * rect.height);
    if (area > largest) largest = area;
  }
  return largest;
}

/**
 * The application, its window, and any container that fills the frame.
 *
 * These are the screen, not a control on it. Letting one stand in as a row's
 * actionable anchor is what collapses an entire iOS screen into one entry. A
 * node with no rect is left alone: absence of geometry is not evidence that it
 * covers everything.
 */
/**
 * Nodes that can carry a control's position: ones that say something, or that
 * contain something which does.
 *
 * A structural key is the only key a row without an identifier keeps across
 * translation, so nothing but the app's content may influence it. Layout-only
 * containers come and go for reasons unrelated to that content — the keyboard is
 * hosted in an unlabeled full-frame shell that exists only while it is
 * presented — and counting them renumbers the rows beside them, which would give
 * one row two different keys in two locales.
 *
 * Ancestors of anything meaningful are meaningful, so a control's own path is
 * always numbered.
 */
export function meaningfulNodeIndexes(
  nodes: readonly SnapshotNode[],
  ignored: ReadonlySet<number> = new Set(),
): Set<number> {
  const parentOf = new Map<number, number | undefined>();
  nodes.forEach((node, offset) => parentOf.set(node.index ?? offset, node.parentIndex));
  const meaningful = new Set<number>();
  nodes.forEach((node, offset) => {
    const index = node.index ?? offset;
    if (ignored.has(index)) return;
    const says = `${node.label ?? ""}${node.value ?? ""}${node.identifier ?? ""}`.trim();
    if (!says) return;
    let current: number | undefined = index;
    let guard = 0;
    while (current !== undefined && guard < 32 && !meaningful.has(current)) {
      meaningful.add(current);
      current = parentOf.get(current);
      guard += 1;
    }
  });
  return meaningful;
}

export function wholeScreenNodeIndexes(nodes: readonly SnapshotNode[]): Set<number> {
  const frame = appFrameArea(nodes);
  const covering = new Set<number>();
  nodes.forEach((node, offset) => {
    const index = node.index ?? offset;
    if (isApplicationFrameRole(node)) {
      covering.add(index);
      return;
    }
    const rect = node.rect;
    if (!rect || frame <= 0) return;
    if (Math.abs(rect.width * rect.height) >= frame * 0.9) covering.add(index);
  });
  return covering;
}
