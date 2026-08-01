import * as Y from "yjs";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toYValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    array.push(value.map(toYValue));
    return array;
  }
  if (isPlainRecord(value)) {
    const map = new Y.Map<unknown>();
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) map.set(key, toYValue(entry));
    }
    return map;
  }
  return value;
}

export function fromYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    return Object.fromEntries(
      [...value.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, fromYValue(entry)]),
    );
  }
  if (value instanceof Y.Array) return value.toArray().map(fromYValue);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return value;
}

export function cloneBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}
