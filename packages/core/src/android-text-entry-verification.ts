import type { SnapshotNode } from "./device-capabilities.js";
import { JobCancelledError, raceCancel } from "./control.js";
import { NativeTextEntryVerificationError } from "./input-not-dispatched.js";

export type AndroidTextEntryReceipt = {
  platform: "android";
  transport: "clipboard" | "adb-shell";
  verification: "exact" | "normalized" | "unverified" | "failed";
  normalization?: "ime-trailing-space";
  reason?:
    | "focused-field-unavailable"
    | "readback-unavailable"
    | "focused-field-changed"
    | "text-mismatch";
  fieldIdentifier?: string;
};

const IME =
  /^(?:com\.android\.systemui|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey|com\.microsoft\.swiftkey)(?::|$)/u;

export async function boundedAndroidTextEntrySnapshot(
  read: () => Promise<SnapshotNode[]>,
): Promise<SnapshotNode[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await raceCancel(
      Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Text entry readback unavailable")), 3000);
        }),
      ]),
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function owner(node: SnapshotNode): string | undefined {
  return (
    node.bundleId ??
    (node.identifier?.includes(":id/") ? node.identifier.split(":id/")[0] : undefined)
  );
}

function editable(node: SnapshotNode): boolean {
  const role = (node.role ?? node.type ?? "").toLowerCase();
  return (
    node.editable === true ||
    /(?:^|\.)(?:edittext|textfield|textview|textbox|textarea|searchfield)$/u.test(role)
  );
}

/** Missing accessibility remains a usable pixel path, with no readback claim. */
export function androidTextEntryField(nodes: readonly SnapshotNode[]): SnapshotNode | undefined {
  const fields = nodes.filter(
    (node) =>
      node.focused === true &&
      editable(node) &&
      node.enabled !== false &&
      node.visibleToUser !== false &&
      owner(node) &&
      !IME.test(owner(node)!),
  );
  const field = fields[0];
  if (fields.length !== 1 || !field || typeof field.value !== "string") return undefined;
  if (!field.identifier && !field.ref && !field.rect) return undefined;
  return structuredClone(field);
}

function sameField(before: SnapshotNode, after: SnapshotNode): boolean {
  if (owner(before) !== owner(after)) return false;
  if (before.identifier) return after.identifier === before.identifier;
  if (before.ref) return after.ref === before.ref;
  if (!before.rect || !after.rect) return false;
  const x = before.rect.x + before.rect.width / 2;
  const y = before.rect.y + before.rect.height / 2;
  return (
    x >= after.rect.x &&
    x <= after.rect.x + after.rect.width &&
    y >= after.rect.y &&
    y <= after.rect.y + after.rect.height
  );
}

/** The caret may be in the middle. Require exactly one insertion and preserve
 * all prior text; casing, punctuation and trailing whitespace stay exact. */
export function exactAndroidTextInsertion(before: string, text: string, after: string): boolean {
  if (after.length !== before.length + text.length) return false;
  if (!text.length) return after === before;
  for (let at = after.indexOf(text); at !== -1; at = after.indexOf(text, at + 1)) {
    if (after.slice(0, at) + after.slice(at + text.length) === before) return true;
  }
  return false;
}

export async function verifyAndroidTextEntry(input: {
  before: SnapshotNode;
  text: string;
  transport: AndroidTextEntryReceipt["transport"];
  snapshot: () => Promise<SnapshotNode[]>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<AndroidTextEntryReceipt> {
  const receipt: AndroidTextEntryReceipt = {
    platform: "android",
    transport: input.transport,
    verification: "exact",
    ...(input.before.identifier ? { fieldIdentifier: input.before.identifier } : {}),
  };
  const sleep =
    input.sleep ??
    ((ms: number) => raceCancel(new Promise<void>((resolve) => setTimeout(resolve, ms))));
  const read = async () => {
    await sleep(150);
    let field: SnapshotNode | undefined;
    try {
      field = androidTextEntryField(await input.snapshot());
    } catch (error) {
      if (error instanceof JobCancelledError) throw error;
    }
    const reason = !field
      ? "readback-unavailable"
      : !sameField(input.before, field)
        ? "focused-field-changed"
        : !exactAndroidTextInsertion(input.before.value!, input.text, field.value!)
          ? input.transport === "adb-shell" &&
            input.text.length > 0 &&
            !/\s$/u.test(input.text) &&
            field.value!.endsWith(" ") &&
            exactAndroidTextInsertion(input.before.value!, input.text, field.value!.slice(0, -1))
            ? undefined
            : "text-mismatch"
          : undefined;
    if (reason)
      throw new NativeTextEntryVerificationError(
        reason === "text-mismatch"
          ? "the field readback does not match the requested text"
          : "the previously readable focused field cannot be verified",
        { ...receipt, verification: "failed", reason },
      );
    if (!exactAndroidTextInsertion(input.before.value!, input.text, field!.value!)) {
      receipt.verification = "normalized";
      receipt.normalization = "ime-trailing-space";
    }
  };
  // Two explicit read-only observations establish stability without repeating
  // paste/type or polling until a wrong value happens to look acceptable.
  await read();
  await read();
  return receipt;
}
