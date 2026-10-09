import { useEffect, useRef, useState } from "react";
import type { EditorSaveState } from "../components/editor-save-status";
import type { Platform } from "../platform/types";

/** Local naming draft; captured actions remain owned by the server recording. */
export function useRecordingNameDraft({
  platform,
  nameDraftKey,
  saved,
  snapshot,
}: {
  platform: Platform;
  nameDraftKey: string;
  saved: boolean;
  snapshot?: { title: string };
}) {
  const [testName, setTestName] = useState("");
  const [nameDraftLoaded, setNameDraftLoaded] = useState(false);
  const [nameSaveState, setNameSaveState] = useState<EditorSaveState>("saved");
  const [nameSaveError, setNameSaveError] = useState<string>();
  const [nameSaveAttempt, setNameSaveAttempt] = useState(0);
  const nameEdits = useRef(0);
  const nameWrites = useRef(Promise.resolve());
  const suggestionApplied = useRef(false);
  useEffect(() => {
    let disposed = false;
    const version = nameEdits.current;
    void Promise.resolve()
      .then(() => platform.storage.get(nameDraftKey))
      .then((stored) => {
        if (disposed) return;
        if (stored && nameEdits.current === version) {
          setTestName(stored);
          suggestionApplied.current = true;
        }
        setNameDraftLoaded(true);
      })
      .catch(() => {
        if (!disposed) {
          setNameDraftLoaded(true);
          setNameSaveState("failed");
          setNameSaveError(
            "Could not load the saved name. Keep this page open until you save the test.",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [nameDraftKey, platform]);

  useEffect(() => {
    if (!nameDraftLoaded || suggestionApplied.current || !snapshot) return;
    suggestionApplied.current = true;
    if (snapshot.title !== "Untitled recording") setTestName(snapshot.title);
  }, [nameDraftLoaded, snapshot]);

  useEffect(() => {
    if (saved || !nameDraftLoaded || nameEdits.current === 0) return;
    let disposed = false;
    setNameSaveState("saving");
    const write = nameWrites.current
      .catch(() => undefined)
      .then(async () => {
        if (testName) await platform.storage.set(nameDraftKey, testName);
        else await platform.storage.remove?.(nameDraftKey);
      });
    nameWrites.current = write;
    void write
      .then(() => {
        if (!disposed) {
          setNameSaveState("saved");
          setNameSaveError(undefined);
        }
      })
      .catch(() => {
        if (!disposed) {
          setNameSaveState("failed");
          setNameSaveError(
            "Could not save the name on this computer. Your captured steps remain saved; keep this page open to retry.",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [nameDraftKey, nameDraftLoaded, platform, saved, testName, nameSaveAttempt]);

  return {
    testName,
    setTestName,
    nameEdits,
    nameWrites,
    nameSaveState,
    setNameSaveState,
    nameSaveError,
    setNameSaveAttempt,
  };
}
