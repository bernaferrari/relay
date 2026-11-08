import { expect, it } from "vitest";
import {
  emptyValidationDraft,
  isValidationDraftReady,
  validationBindingFromDraft,
  validationDraft,
} from "./test-editor-assertion-model";
it("round-trips an upscaled media check without losing its source and exact dimensions", () => {
  const draft = {
    kind: "media-check",
    file: "generated/1080.mp4",
    media: "video",
    width: "1920",
    height: "1080",
    minDurationMs: "5000",
    minBytes: "100",
    sourceFile: "generated/720.mp4",
    relation: "upscaled",
  } as const;
  expect(isValidationDraftReady(draft)).toBe(true);
  const binding = validationBindingFromDraft(draft);
  expect(binding).toEqual({
    status: "resolved",
    kind: "recipe-step",
    step: {
      kind: "media-check",
      file: "generated/1080.mp4",
      media: "video",
      width: 1920,
      height: 1080,
      minDurationMs: 5000,
      minBytes: 100,
      sourceFile: "generated/720.mp4",
      relation: "upscaled",
    },
  });
  expect(
    validationDraft({ id: "check", kind: "validation", intent: "Verify 1080p", binding }),
  ).toEqual(draft);
});
it("refuses invalid dimensions and comparison without a source", () => {
  const draft = emptyValidationDraft("media-check");
  if (draft.kind !== "media-check") throw new Error("Wrong draft");
  for (const width of ["0", "-1", "1.5", "nope"])
    expect(isValidationDraftReady({ ...draft, width })).toBe(false);
  expect(isValidationDraftReady({ ...draft, relation: "extended" })).toBe(false);
  expect(() => validationBindingFromDraft({ ...draft, relation: "extended" })).toThrow(
    "source file",
  );
});
it("preserves an exact download target when only its output path changes", () => {
  const step = {
    kind: "download",
    file: "generated/old.mp4",
    target: { label: "Download", identifier: "download-button" },
  } as const;
  const draft = validationDraft({
    id: "download",
    kind: "validation",
    intent: "Save video",
    binding: { kind: "recipe-step", status: "resolved", step },
  });
  if (draft?.kind !== "download") throw new Error("No download draft");
  expect(validationBindingFromDraft({ ...draft, file: "generated/new.mp4" })).toEqual({
    kind: "recipe-step",
    status: "resolved",
    step: { ...step, file: "generated/new.mp4" },
  });
});
