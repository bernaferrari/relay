export type JsonValueBounds = {
  maxDepth: number;
  maxStringBytes: number;
  maxArrayItems: number;
  maxObjectEntries: number;
  maxNodes: number;
  maxSerializedBytes: number;
};

export type BoundedJsonMeasurement = { nodes: number; serializedBytes: number };

const encoder = new TextEncoder();

function bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function assertLimit(value: number, limit: number, label: string): void {
  if (value > limit) throw new TypeError(`${label} exceeds the supported limit (${limit})`);
}

/** Measure JSON exactly without first materializing the complete serialized
 * document. This must run before recursive schema parsing at untrusted
 * transport boundaries so depth and container limits cannot be bypassed by
 * lying about a manifest byte count. */
export function measureBoundedJsonValue(
  value: unknown,
  limits: JsonValueBounds,
  label = "JSON value",
): BoundedJsonMeasurement {
  type Frame = { value: unknown; depth: number };
  const stack: Frame[] = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let serializedBytes = 0;

  while (stack.length) {
    const frame = stack.pop()!;
    assertLimit(frame.depth, limits.maxDepth, `${label} depth`);
    nodes += 1;
    assertLimit(nodes, limits.maxNodes, `${label} node count`);
    const item = frame.value;
    if (item === null) {
      serializedBytes += 4;
    } else if (typeof item === "string") {
      const stringBytes = bytes(JSON.stringify(item));
      assertLimit(stringBytes, limits.maxStringBytes, `${label} string`);
      serializedBytes += stringBytes;
    } else if (typeof item === "boolean") {
      serializedBytes += item ? 4 : 5;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(`${label} contains a non-finite number`);
      serializedBytes += bytes(JSON.stringify(item));
    } else if (Array.isArray(item)) {
      if (seen.has(item)) throw new TypeError(`${label} contains a cycle`);
      seen.add(item);
      assertLimit(item.length, limits.maxArrayItems, `${label} array length`);
      serializedBytes += 2 + Math.max(0, item.length - 1);
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], depth: frame.depth + 1 });
      }
    } else if (item && typeof item === "object") {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new TypeError(`${label} contains a non-JSON object`);
      }
      if (seen.has(item)) throw new TypeError(`${label} contains a cycle`);
      seen.add(item);
      const entries = Object.entries(item as Record<string, unknown>);
      assertLimit(entries.length, limits.maxObjectEntries, `${label} object size`);
      serializedBytes += 2 + Math.max(0, entries.length - 1);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]!;
        const keyBytes = bytes(JSON.stringify(key));
        assertLimit(keyBytes, limits.maxStringBytes, `${label} key`);
        serializedBytes += keyBytes + 1;
        stack.push({ value: child, depth: frame.depth + 1 });
      }
    } else {
      throw new TypeError(`${label} contains a value that JSON cannot represent`);
    }
    assertLimit(serializedBytes, limits.maxSerializedBytes, `${label} serialized bytes`);
  }
  return { nodes, serializedBytes };
}
