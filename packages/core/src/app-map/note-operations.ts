import { appMapFail } from "./errors.js";
import type { AppMap, AppMapNote } from "./model.js";
import { assertAppMapNote, identifier } from "./validation-shapes.js";

function scopeFor(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

/**
 * Notes are first-class canvas entities rather than a single replace-only
 * object. That keeps a collaborator moving one sticky note from overwriting a
 * different note added at the same time, and maps directly to a CRDT entity
 * map keyed by note id.
 */
export function saveAppMapNote(draft: AppMap, note: AppMapNote): void {
  assertAppMapNote(note, scopeFor(draft), "note");
  draft.notes[note.id] = structuredClone(note);
}

export function removeAppMapNote(draft: AppMap, noteId: string): void {
  identifier(noteId, "noteId");
  if (!draft.notes[noteId]) {
    appMapFail("missing-reference", `Note ${noteId} does not exist`);
  }
  delete draft.notes[noteId];
}
