import type { SnapshotNode } from "./device.js";

/** Home notices and suggestions do not identify the workspace. Prove the
 * owned, selected header and empty composer before omitting that body from
 * identity. The caller retains the complete screenshot and accessibility tree. */
export function nativeHomeIdentityNodes(
  nodes: readonly SnapshotNode[],
  packageName: string,
): readonly SnapshotNode[] | undefined {
  const visible = nodes.filter(
    (node) =>
      node.visibleToUser !== false &&
      node.bundleId !== "com.android.systemui" &&
      !/^(?:com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)$/u.test(
        node.bundleId ?? "",
      ),
  );
  if (visible.some((node) => node.bundleId !== packageName || /dialog/iu.test(node.type ?? "")))
    return undefined;
  const unique = (predicate: (node: SnapshotNode) => boolean) => {
    const found = visible.filter(predicate);
    return found.length === 1 ? found[0] : undefined;
  };
  const root = unique((node) => node.identifier === `${packageName}:id/action_bar_root`);
  const header = unique((node) => node.identifier === "conversation_top_bar");
  if (
    !root?.rect ||
    !header?.rect ||
    header.rect.y !== 0 ||
    header.rect.height > root.rect.height * 0.2
  )
    return undefined;
  const headerBottom = header.rect.y + header.rect.height;
  const inHeader = (node: SnapshotNode) =>
    Boolean(node.rect && node.rect.y >= 0 && node.rect.y + node.rect.height <= headerBottom);
  const ask = unique((node) => node.label === "Ask" && inHeader(node));
  const selected = visible.find((node) => node.index === ask?.parentIndex);
  if (
    !ask ||
    ask.enabled === false ||
    selected?.selected !== true ||
    selected.enabled === false ||
    !inHeader(selected)
  )
    return undefined;
  for (const label of ["Imagine", "Build", "Show navigation drawer", "Private Chat"]) {
    if (!unique((node) => node.label === label && node.enabled !== false && inHeader(node)))
      return undefined;
  }
  const input = unique(
    (node) => node.identifier === "chat_text_input" && node.type === "android.widget.EditText",
  );
  if (
    !input?.rect ||
    input.enabled === false ||
    input.value?.trim() ||
    input.rect.y <= headerBottom
  )
    return undefined;
  const byIndex = new Map(visible.map((node) => [node.index, node]));
  const composer = byIndex.get(input.parentIndex);
  if (!composer || composer.index === undefined) return undefined;
  const inComposer = (node: SnapshotNode) => {
    let current: SnapshotNode | undefined = node;
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (current.index === composer.index) return true;
      current = byIndex.get(current.parentIndex);
    }
    return false;
  };
  for (const label of [
    "Launch gallery selector",
    "Ask anything",
    "Start dictation",
    "Start Grok Voice",
  ]) {
    if (!unique((node) => node.label === label && node.enabled !== false && inComposer(node)))
      return undefined;
  }
  return visible.filter(
    (node) =>
      (node === root || inHeader(node) || inComposer(node)) &&
      Boolean(
        node.label ||
        node.value ||
        node.identifier ||
        node.selected ||
        node === input ||
        /Button$/u.test(node.type ?? ""),
      ),
  );
}
