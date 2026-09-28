/** Describe the saved document and local draft state independently of the editor UI. */
export function testEditorSaveState(pending: boolean, notice: string, hasDrafts: boolean) {
  const state = pending
    ? "saving"
    : notice.startsWith("Conflict")
      ? "conflicted"
      : notice.startsWith("Could not") ||
          notice.toLowerCase().includes("failed") ||
          notice.includes("unavailable")
        ? "failed"
        : hasDrafts
          ? "dirty"
          : "saved";
  return {
    state,
    detail: hasDrafts && notice === "Saved" ? "Unsaved draft" : notice,
  } as const;
}
