import { useEffect, useRef, useState } from "react";
import type { Platform } from "../platform/types";

export type StepDraft = { intent: string; note: string; capture: boolean };

function isStepDraftRecord(value: unknown): value is Record<string, StepDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (draft) =>
      Boolean(draft) &&
      typeof draft === "object" &&
      typeof (draft as StepDraft).intent === "string" &&
      typeof (draft as StepDraft).note === "string" &&
      typeof (draft as StepDraft).capture === "boolean",
  );
}

export function useTestStepDrafts(
  platform: Platform,
  testId: string,
  setSaveNotice: (notice: string) => void,
) {
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  const [draftsLoadedFor, setDraftsLoadedFor] = useState<string>();
  const [connectionScope, setConnectionScope] = useState<string>();
  const draftEditRevision = useRef(0);
  const draftPersistence = useRef<{ key?: string; chain: Promise<void> }>({
    chain: Promise.resolve(),
  });
  const draftStorageKey = connectionScope
    ? `test-editor-drafts:${encodeURIComponent(connectionScope)}:${encodeURIComponent(testId)}`
    : undefined;

  useEffect(() => {
    let disposed = false;
    void Promise.resolve(platform.getServerConnection?.())
      .then(async (connection) => {
        const url = connection?.url ?? (await Promise.resolve(platform.getServerUrl()));
        return JSON.stringify({
          url,
          organizationId: connection?.organizationId ?? "",
          projectId: connection?.projectId ?? "",
          actorId: connection?.actorId ?? "",
        });
      })
      .then((scope) => {
        if (!disposed) setConnectionScope(scope);
      })
      .catch(() => {
        if (!disposed)
          setSaveNotice("Local draft storage unavailable; keep this editor open until you save.");
      });
    return () => {
      disposed = true;
    };
  }, [platform, setSaveNotice]);

  useEffect(() => {
    if (!draftStorageKey) return;
    let disposed = false;
    const loadRevision = draftEditRevision.current;
    setDraftsLoadedFor(undefined);
    if (loadRevision === 0) setStepDrafts({});
    void Promise.resolve()
      .then(() => platform.storage.get(draftStorageKey))
      .then((stored) => {
        if (disposed) return;
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as unknown;
            if (isStepDraftRecord(parsed)) {
              setStepDrafts((current) =>
                draftEditRevision.current === loadRevision ? parsed : { ...parsed, ...current },
              );
            }
          } catch {
            // Ignore stale or malformed local drafts; the durable Test remains authoritative.
          }
        }
        setDraftsLoadedFor(draftStorageKey);
      })
      .catch(() => {
        if (!disposed) setDraftsLoadedFor(draftStorageKey);
      });
    return () => {
      disposed = true;
    };
  }, [draftStorageKey, platform]);

  useEffect(() => {
    if (!draftStorageKey || draftsLoadedFor !== draftStorageKey) return;
    const payload = JSON.stringify(stepDrafts);
    if (draftPersistence.current.key !== draftStorageKey) {
      draftPersistence.current = { key: draftStorageKey, chain: Promise.resolve() };
    }
    const previous = draftPersistence.current.chain;
    draftPersistence.current.chain = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          if (Object.keys(stepDrafts).length)
            await Promise.resolve(platform.storage.set(draftStorageKey, payload));
          else await Promise.resolve(platform.storage.remove?.(draftStorageKey));
        } catch {
          setSaveNotice("Local draft save failed; kept in memory");
        }
      });
  }, [draftStorageKey, draftsLoadedFor, platform, setSaveNotice, stepDrafts]);

  function updateStepDraft(stepId: string, draft: StepDraft) {
    draftEditRevision.current += 1;
    setStepDrafts((current) => ({ ...current, [stepId]: draft }));
  }

  function clearStepDraftIfUnchanged(stepId: string, expected: StepDraft) {
    setStepDrafts((current) => {
      const draft = current[stepId];
      if (
        !draft ||
        draft.intent !== expected.intent ||
        draft.note !== expected.note ||
        draft.capture !== expected.capture
      ) {
        return current;
      }
      const next = { ...current };
      delete next[stepId];
      return next;
    });
  }

  return { stepDrafts, updateStepDraft, clearStepDraftIfUnchanged };
}
