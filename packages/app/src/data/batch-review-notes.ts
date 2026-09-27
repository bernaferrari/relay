export type BatchReviewNote = {
  caseId: string;
  text: string;
  at: number;
  actorId: string;
};

export function parseBatchReviewNotes(raw: string | null | undefined): BatchReviewNote[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new TypeError("Review notes are invalid.");
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.caseId !== "string" ||
      typeof record.text !== "string" ||
      typeof record.at !== "number" ||
      typeof record.actorId !== "string"
    ) {
      return [];
    }
    const text = record.text.trim();
    if (!text) return [];
    return [
      {
        caseId: record.caseId,
        text,
        at: record.at,
        actorId: record.actorId,
      },
    ];
  });
}

export function appendBatchReviewNote(
  notes: readonly BatchReviewNote[],
  note: BatchReviewNote,
): BatchReviewNote[] {
  const text = note.text.trim();
  if (!text) return [...notes];
  return [...notes, { ...note, text }];
}

export function batchReviewNotesKey(batchId: string): string {
  return `batch-review-notes:${batchId}`;
}

export function notesForCase(
  notes: readonly BatchReviewNote[],
  caseId: string,
): readonly BatchReviewNote[] {
  return notes.filter((note) => note.caseId === caseId);
}
