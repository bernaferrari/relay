import type { ProductMapPath } from "@relay/product/map-exploration";

/** Back, close, dismiss and similar moves return to an earlier screen. */
export function isRoutineReturn(path: Pick<ProductMapPath, "label" | "toScreenId">): boolean {
  return Boolean(
    path.toScreenId && /^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
  );
}
