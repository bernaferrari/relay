import { useEffect, useRef, useState } from "react";
import type { Platform } from "../platform/types";

import type { StepDraft } from "../components/test-editor-step";
export type { StepDraft } from "../components/test-editor-step";

function validExpected(value: StepDraft["expected"]): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  if (value.kind === "screen") return typeof value.screenId === "string";
  if (value.kind === "visual") {
    return (
      typeof value.criteria === "string" &&
      typeof value.region === "string" &&
      typeof value.requireAgreement === "boolean"
    );
  }
  if (value.kind === "semantic") {
    return (
      typeof value.input === "string" &&
      typeof value.criteria === "string" &&
      typeof value.requireAgreement === "boolean"
    );
  }
  if (value.kind === "wait-response") {
    return typeof value.label === "string" && typeof value.maxMs === "string";
  }
  if (value.kind === "identity-ignore") {
    return typeof value.name === "string" && typeof value.region === "string";
  }
  return (
    value.kind === "content" &&
    typeof value.input === "string" &&
    typeof value.expected === "string" &&
    ["exact", "equals", "contains", "not-contains", "number-equals", "field"].includes(value.match)
  );
}

function isStepDraftRecord(value: unknown): value is Record<string, StepDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (draft) =>
      Boolean(draft) &&
      typeof draft === "object" &&
      typeof (draft as StepDraft).intent === "string" &&
      typeof (draft as StepDraft).note === "string" &&
      typeof (draft as StepDraft).capture === "boolean" &&
      validExpected((draft as StepDraft).expected),
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
    void Promise.resolve()
      .then(() => platform.getServerConnection?.())
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
            if (!isStepDraftRecord(parsed)) throw new Error("Invalid local draft");
            {
              setStepDrafts((current) =>
                draftEditRevision.current === loadRevision ? parsed : { ...parsed, ...current },
              );
            }
          } catch {
            setSaveNotice("Could not restore local drafts; keep this editor open until you save.");
            return;
          }
        }
        setDraftsLoadedFor(draftStorageKey);
      })
      .catch(() => {
        if (!disposed)
          setSaveNotice("Could not restore local drafts; keep this editor open until you save.");
      });
    return () => {
      disposed = true;
    };
  }, [draftStorageKey, platform, setSaveNotice]);

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
        draft.capture !== expected.capture ||
        JSON.stringify(draft.expected) !== JSON.stringify(expected.expected)
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
