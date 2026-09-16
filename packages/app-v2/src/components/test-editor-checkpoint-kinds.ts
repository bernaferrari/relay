export const VALIDATION_KIND_GROUPS = [
  {
    id: "capture",
    label: "Capture",
    kinds: [{ value: "capture", label: "Screenshot for review" }],
  },
  {
    id: "check",
    label: "Check",
    kinds: [
      { value: "screen", label: "Screen" },
      { value: "content", label: "Content" },
    ],
  },
  {
    id: "wait",
    label: "Wait",
    kinds: [
      { value: "wait-response", label: "Reply wait" },
      { value: "extract", label: "Remember reply" },
    ],
  },
  {
    id: "comparison",
    label: "Judges",
    kinds: [
      { value: "semantic", label: "Semantic judge" },
      { value: "visual", label: "Visual judge" },
    ],
  },
  {
    id: "identity",
    label: "Ignore region",
    kinds: [{ value: "identity-ignore", label: "Ignore for identity" }],
  },
] as const;

const REPLY_VALIDATION_KINDS = new Set(["extract", "semantic"]);

/** Hide Remember reply / Semantic judge unless this Test already has a reply. */
export function validationKindGroupsForEditor(options: {
  hasRememberableReply: boolean;
  selected?: string;
}) {
  const allowReply =
    options.hasRememberableReply ||
    (options.selected !== undefined && REPLY_VALIDATION_KINDS.has(options.selected));
  if (allowReply) return VALIDATION_KIND_GROUPS;
  return VALIDATION_KIND_GROUPS.map((group) => ({
    ...group,
    kinds: group.kinds.filter((kind) => !REPLY_VALIDATION_KINDS.has(kind.value)),
  })).filter((group) => group.kinds.length > 0);
}
