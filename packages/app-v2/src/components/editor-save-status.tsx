/** @jsxImportSource react */
import { Check, CircleAlert, LoaderCircle, Pencil } from "lucide-react";

export type EditorSaveState = "dirty" | "saving" | "saved" | "failed" | "conflicted";

export function EditorSaveStatus({ state, detail }: { state: EditorSaveState; detail?: string }) {
  const Icon =
    state === "saved"
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
    failed: "Could not save",
    conflicted: "Revision changed",
  }[state];
  return (
    <span
      data-slot="editor-save-status"
      className={`inline-flex items-center gap-1.5 text-xs ${state === "failed" || state === "conflicted" ? "text-destructive" : "text-muted-foreground"}`}
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <Icon size={14} aria-hidden="true" />
      {detail ?? label}
    </span>
  );
}
