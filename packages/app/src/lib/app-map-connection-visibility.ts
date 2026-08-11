export type CanvasConnectionFocus = {
  selectedConnectionId: string | null;
  selectedGroupId: string | null;
  selectedScreenIds: ReadonlySet<string>;
};

type VisibleConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
};

/**
 * Keep local structure visible while revealing long cross-section routes only
 * in context. Every displayed route remains a canonical screen connection;
 * the overview never invents an aggregate line with no visible provenance.
 */
export function shouldDisplayCanvasConnection(
  connection: VisibleConnection,
  groupForScreen: ReadonlyMap<string, string>,
  focus: CanvasConnectionFocus,
): boolean {
  const fromGroupId = groupForScreen.get(connection.fromScreenId);
  const toGroupId = groupForScreen.get(connection.toScreenId);
  if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) return true;

  return (
    connection.id === focus.selectedConnectionId ||
    focus.selectedScreenIds.has(connection.fromScreenId) ||
    focus.selectedScreenIds.has(connection.toScreenId) ||
    focus.selectedGroupId === fromGroupId ||
    focus.selectedGroupId === toGroupId
  );
}
