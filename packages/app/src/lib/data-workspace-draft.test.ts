import assert from "node:assert/strict";
import test from "node:test";
import {
  readPendingDataWorkspaceDraft,
  removePendingDataWorkspaceDraft,
  writePendingDataWorkspaceDraft,
} from "./data-workspace-draft";

function withStorage(run: (storage: Map<string, string>) => void): void {
  const values = new Map<string, string>();
  const previous = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    run(values);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  }
}

test("pending data drafts remain until a canonical save succeeds", () => {
  const draft = [
    {
      id: "language",
      name: "Language",
      scope: "shared" as const,
      source: "static" as const,
      values: ["en"],
    },
  ];
  withStorage((storage) => {
    writePendingDataWorkspaceDraft("project", draft);
    assert.deepEqual(readPendingDataWorkspaceDraft("project"), draft);
    assert.equal(storage.size, 1);
    removePendingDataWorkspaceDraft("project");
    assert.equal(readPendingDataWorkspaceDraft("project"), undefined);
  });
});

test("offline or failed saves leave their recoverable pending draft", () => {
  const draft = [
    { id: "account", name: "Account", scope: "private" as const, source: "static" as const },
  ];
  withStorage(() => {
    writePendingDataWorkspaceDraft("offline", draft);
    assert.deepEqual(readPendingDataWorkspaceDraft("offline"), draft);
  });
});

test("malformed pending data is ignored instead of entering the editor", () => {
  withStorage((storage) => {
    storage.set("relay.variable-pending-draft.v1:malformed", JSON.stringify([{ id: 42 }]));
    assert.equal(readPendingDataWorkspaceDraft("malformed"), undefined);
  });
});

test("restricted browser storage never blocks editing", () => {
  const previous = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    },
  });
  try {
    assert.doesNotThrow(() => writePendingDataWorkspaceDraft("restricted", []));
    assert.equal(readPendingDataWorkspaceDraft("restricted"), undefined);
    assert.doesNotThrow(() => removePendingDataWorkspaceDraft("restricted"));
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});
