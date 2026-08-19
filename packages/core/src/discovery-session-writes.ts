const pending = new Map<string, Promise<unknown>>();

/**
 * Serialize read-modify-write on one discovery session file.
 *
 * Every mutation re-reads the whole session, edits it, and writes it back. Two
 * of those interleaving lose an update: a crawl persisting its stop reason can
 * put `status: "running"` back over a cancel that landed in between. Queueing by
 * session id keeps concurrent writers honest without a cross-process lock, which
 * is enough because one server owns the workspace.
 */
export function serializeSessionWrite<T>(id: string, apply: () => Promise<T>): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.then(apply, apply);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  pending.set(id, settled);
  void settled.then(() => {
    if (pending.get(id) === settled) pending.delete(id);
  });
  return next;
}
