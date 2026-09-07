/** Process liveness only. Durable receipts remain the outcome authority. */
const active = new Map<string, number>();
function key(scope: { organizationId: string; projectId: string }, workflowId: string): string {
  return JSON.stringify([scope.organizationId, scope.projectId, workflowId]);
}
export function trackAuthoringDispatch(
  scope: { organizationId: string; projectId: string },
  workflowId: string,
): () => void {
  const id = key(scope, workflowId);
  active.set(id, (active.get(id) ?? 0) + 1);
  return () => {
    const count = (active.get(id) ?? 1) - 1;
    if (count) active.set(id, count);
    else active.delete(id);
  };
}
export function authoringDispatchIsActive(
  scope: { organizationId: string; projectId: string },
  workflowId: string,
): boolean {
  return active.has(key(scope, workflowId));
}
