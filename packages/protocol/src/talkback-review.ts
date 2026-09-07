/** TalkBack-oriented review of an Android accessibility snapshot.
 * This is a projection of captured nodes, not a second TalkBack engine. */

export type TalkBackIssueCode =
  | "missing-name"
  | "icon-without-name"
  | "unnamed-edit"
  | "name-is-resource-id"
  | "name-is-class"
  | "duplicate-name"
  | "parent-repeats-child";

export type TalkBackIssue = {
  code: TalkBackIssueCode;
  severity: "error" | "warning";
  detail: string;
};

export type TalkBackReviewItem = {
  id: string;
  index: number;
  announcement: string;
  name?: string;
  role?: string;
  description?: string;
  text?: string;
  identifier?: string;
  rect?: { x: number; y: number; width: number; height: number };
  interactive: boolean;
  issues: TalkBackIssue[];
};

export type TalkBackReview = {
  items: TalkBackReviewItem[];
  issues: TalkBackReviewItem[];
  errorCount: number;
  warningCount: number;
};

type TalkBackNode = {
  label?: string;
  value?: string;
  text?: string;
  description?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  index?: number;
  parentIndex?: number;
};

const CLASS_NAMES = new Set([
  "View",
  "ViewGroup",
  "FrameLayout",
  "LinearLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "CoordinatorLayout",
  "ImageView",
  "ImageButton",
  "TextView",
  "Button",
  "ScrollView",
  "RecyclerView",
  "ListView",
  "NestedScrollView",
  "HorizontalScrollView",
  "ViewPager",
  "ViewPager2",
]);

const SCROLL_TYPES = new Set([
  "ScrollView",
  "NestedScrollView",
  "HorizontalScrollView",
  "RecyclerView",
  "ListView",
  "GridView",
  "ViewPager",
  "ViewPager2",
]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shortType(value: string | undefined): string {
  if (!value) return "";
  return (
    value
      .replace(/^android\.(widget|view|webkit)\./u, "")
      .split(".")
      .pop() ?? value
  );
}

function nodeFromUnknown(value: unknown, index: number): TalkBackNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { index };
  const node = value as Record<string, unknown>;
  const rect =
    node.rect && typeof node.rect === "object" && !Array.isArray(node.rect)
      ? (node.rect as TalkBackNode["rect"])
      : undefined;
  return {
    ...(text(node.label) ? { label: text(node.label) } : {}),
    ...(text(node.value) ? { value: text(node.value) } : {}),
    ...(text(node.text) ? { text: text(node.text) } : {}),
    ...(text(node.description) ? { description: text(node.description) } : {}),
    ...(text(node.identifier) ? { identifier: text(node.identifier) } : {}),
    ...(text(node.role) ? { role: text(node.role) } : {}),
    ...(text(node.type) ? { type: text(node.type) } : {}),
    ...(node.enabled === false ? { enabled: false } : {}),
    ...(node.selected === true ? { selected: true } : {}),
    ...(node.visibleToUser === false ? { visibleToUser: false } : {}),
    ...(node.hittable === true ? { hittable: true } : {}),
    ...(rect &&
    [rect.x, rect.y, rect.width, rect.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    )
      ? { rect }
      : {}),
    index: typeof node.index === "number" ? node.index : index,
    ...(typeof node.parentIndex === "number" ? { parentIndex: node.parentIndex } : {}),
  };
}

export function talkBackSpokenName(node: TalkBackNode): string | undefined {
  return node.description ?? node.label ?? node.text ?? node.value;
}

export function talkBackRole(node: TalkBackNode): string | undefined {
  const type = shortType(node.role ?? node.type);
  const roles: Record<string, string> = {
    Button: "Button",
    ImageButton: "Button",
    CompoundButton: "Button",
    CheckBox: "Checkbox",
    Switch: "Switch",
    SwitchCompat: "Switch",
    RadioButton: "Radio button",
    EditText: "Edit box",
    MultiAutoCompleteTextView: "Edit box",
    AutoCompleteTextView: "Edit box",
    ImageView: "Image",
    SeekBar: "Slider",
    ProgressBar: "Progress bar",
    Spinner: "Dropdown",
    ToggleButton: "Switch",
    CheckedTextView: "Checkbox",
    TabWidget: "Tab",
  };
  if (roles[type]) return roles[type];
  if (node.hittable && !SCROLL_TYPES.has(type) && type !== "TextView") return "Button";
  return undefined;
}

export function talkBackAnnouncement(node: TalkBackNode): string {
  const name = talkBackSpokenName(node);
  const role = talkBackRole(node);
  const states: string[] = [];
  if (node.enabled === false) states.push("disabled");
  if (node.selected === true) states.push("selected");
  return [name ?? (isInteractive(node) ? "Unnamed" : undefined), role, ...states]
    .filter(Boolean)
    .join(", ");
}

function isInteractive(node: TalkBackNode): boolean {
  const type = shortType(node.role ?? node.type);
  if (SCROLL_TYPES.has(type)) return false;
  if (type === "EditText" || type === "ImageButton") return true;
  if (type === "ImageView") return node.hittable === true;
  if (/Button|CheckBox|Switch|RadioButton|Spinner|SeekBar/u.test(type)) return true;
  return node.hittable === true && type !== "TextView";
}

function looksLikeResourceId(name: string, identifier?: string): boolean {
  if (identifier && name === identifier) return true;
  return /:id\//u.test(name) || /^[a-z][a-z0-9_]*\.[a-z0-9_.]+:/iu.test(name);
}

function looksLikeClassName(name: string): boolean {
  if (CLASS_NAMES.has(name)) return true;
  return /^(android|androidx|com\.google\.android)\./u.test(name);
}

function nodeIssues(node: TalkBackNode, name: string | undefined): TalkBackIssue[] {
  const issues: TalkBackIssue[] = [];
  const type = shortType(node.role ?? node.type);
  const interactive = isInteractive(node);
  if (interactive && !name) {
    if (type === "ImageView" || type === "ImageButton") {
      issues.push({
        code: "icon-without-name",
        severity: "error",
        detail: "TalkBack has no name for this icon.",
      });
    } else if (type === "EditText") {
      issues.push({
        code: "unnamed-edit",
        severity: "error",
        detail: "TalkBack has no name for this field.",
      });
    } else {
      issues.push({
        code: "missing-name",
        severity: "error",
        detail: "TalkBack has no name for this control.",
      });
    }
  }
  if (name && looksLikeResourceId(name, node.identifier)) {
    issues.push({
      code: "name-is-resource-id",
      severity: "warning",
      detail: `TalkBack would speak the resource id “${name}”.`,
    });
  }
  if (name && looksLikeClassName(name)) {
    issues.push({
      code: "name-is-class",
      severity: "warning",
      detail: `TalkBack would speak the class name “${name}”.`,
    });
  }
  return issues;
}

function area(rect: NonNullable<TalkBackNode["rect"]>): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function contains(
  outer: NonNullable<TalkBackNode["rect"]>,
  inner: NonNullable<TalkBackNode["rect"]>,
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Project TalkBack spoken names and reviewable issues from a captured tree. */
export function reviewAndroidTalkBack(nodes: readonly unknown[]): TalkBackReview {
  const parsed = nodes.map(nodeFromUnknown).filter((node) => node.visibleToUser !== false);
  const items: TalkBackReviewItem[] = [];
  for (const node of parsed) {
    const type = shortType(node.role ?? node.type);
    const name = talkBackSpokenName(node);
    const interactive = isInteractive(node);
    if (!interactive && !name) continue;
    if (SCROLL_TYPES.has(type) && !name) continue;
    if (node.rect && area(node.rect) <= 0) continue;
    const issues = nodeIssues(node, name);
    const announcement = talkBackAnnouncement(node);
    if (!announcement && !issues.length) continue;
    items.push({
      id: `${node.identifier ?? name ?? type ?? "node"}:${node.index}:${Math.round(node.rect?.x ?? 0)}:${Math.round(node.rect?.y ?? 0)}`,
      index: node.index ?? items.length,
      announcement,
      ...(name ? { name } : {}),
      ...(talkBackRole(node) ? { role: talkBackRole(node) } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...((node.text ?? node.value) ? { text: node.text ?? node.value } : {}),
      ...(node.identifier ? { identifier: node.identifier } : {}),
      ...(node.rect ? { rect: node.rect } : {}),
      interactive,
      issues,
    });
  }

  const byName = new Map<string, TalkBackReviewItem[]>();
  for (const item of items) {
    if (!item.interactive || !item.name) continue;
    const key = `${item.name}\0${item.role ?? ""}`;
    const group = byName.get(key) ?? [];
    group.push(item);
    byName.set(key, group);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      item.issues.push({
        code: "duplicate-name",
        severity: "warning",
        detail: `TalkBack would hear “${item.name}” ${group.length} times on this screen.`,
      });
    }
  }

  for (const item of items) {
    if (!item.interactive || !item.name || !item.rect) continue;
    const child = items.find(
      (other) =>
        other !== item &&
        other.name === item.name &&
        other.rect &&
        contains(item.rect!, other.rect) &&
        area(other.rect) < area(item.rect!),
    );
    if (!child) continue;
    if (item.issues.some((issue) => issue.code === "parent-repeats-child")) continue;
    item.issues.push({
      code: "parent-repeats-child",
      severity: "warning",
      detail: "TalkBack may speak this name twice: the row and the label inside it.",
    });
  }

  const withIssues = items.filter((item) => item.issues.length);
  return {
    items,
    issues: withIssues,
    errorCount: withIssues.reduce(
      (count, item) => count + item.issues.filter((issue) => issue.severity === "error").length,
      0,
    ),
    warningCount: withIssues.reduce(
      (count, item) => count + item.issues.filter((issue) => issue.severity === "warning").length,
      0,
    ),
  };
}
