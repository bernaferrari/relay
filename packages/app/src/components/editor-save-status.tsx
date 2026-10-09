/** @jsxImportSource react */
import { Check, CircleAlert, LoaderCircle, Pencil } from "lucide-react";
import { useEffect, useState } from "react";

export type EditorSaveState =
  | "dirty"
  | "saving"
  | "saved"
  | "saved-locally"
  | "failed"
  | "conflicted";

export function EditorSaveStatus({ state, detail }: { state: EditorSaveState; detail?: string }) {
  // "Saved" confirms, then gets out of the way; problems and progress stay visible.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (state !== "saved") return;
    const timer = window.setTimeout(() => setSettled(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [state, detail]);
  const Icon =
    state === "saved" || state === "saved-locally"
      ? Check
      : state === "saving"
        ? LoaderCircle
        : state === "dirty"
          ? Pencil
          : CircleAlert;
  const label = {
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    "saved-locally": "Saved locally",
    failed: "Couldn’t save — your changes are kept",
    conflicted: "Conflict — your changes are preserved",
  }[state];
  return (
    <span
      data-slot="editor-save-status"
      className={`inline-flex items-center gap-1.5 text-xs transition-opacity duration-500 ${settled ? "opacity-0" : ""} ${state === "failed" || state === "conflicted" ? "text-destructive" : "text-muted-foreground"}`}
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <Icon size={14} aria-hidden="true" />
      {detail ?? label}
    </span>
  );
}
