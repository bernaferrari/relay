/** @jsxImportSource react */
import { act } from "react";
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  runConfigurationStorageKey,
  usePersistedRunConfiguration,
  type AsyncRunConfigurationStorage,
} from "./use-persisted-run-configuration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function settle() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Harness({
  storage,
  storageKey,
  initial = {},
}: {
  storage: AsyncRunConfigurationStorage;
  storageKey?: string;
  initial?: { targetProfileId?: string };
}) {
  const persisted = usePersistedRunConfiguration({ storage, key: storageKey, initial });
  const [next, setNext] = useState("edited");
  return createElement(
    "div",
    null,
    createElement("output", { "data-state": true }, JSON.stringify(persisted.selection)),
    createElement("output", { "data-loading": true }, String(persisted.loading)),
    createElement("output", { "data-error": true }, persisted.error ?? ""),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          persisted.setSelection({ targetProfileId: next });
          setNext("latest");
        },
      },
      "edit",
    ),
    createElement("button", { type: "button", onClick: persisted.retry }, "retry"),
  );
}

function render(input: Parameters<typeof Harness>[0]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(Harness, input)));
  return { host, root };
}

function state(host: HTMLElement) {
  return host.querySelector("[data-state]")?.textContent ?? "";
}

describe("run configuration persistence", () => {
  it("scopes keys to the complete workspace identity", () => {
    expect(
      runConfigurationStorageKey({
        server: "relay",
        organization: "org",
        project: "project",
        appId: "app",
        entity: "test",
      }),
    ).toBe('run-config:["relay","org","project","app","test"]');
  });

  it("does not let a late read from the previous key overwrite the new key", async () => {
    const reads = new Map<string, { resolve(value: string | null): void }>();
    const storage: AsyncRunConfigurationStorage = {
      get: (key) => new Promise((resolve) => reads.set(key, { resolve })),
      set: async () => undefined,
    };
    const { host, root } = render({ storage, storageKey: "workspace:a" });
    await settle();
    await act(async () =>
      root.render(createElement(Harness, { storage, storageKey: "workspace:b" })),
    );
    await settle();
    reads.get("workspace:a")?.resolve(JSON.stringify({ targetProfileId: "stale" }));
    reads.get("workspace:b")?.resolve(JSON.stringify({ targetProfileId: "current" }));
    await settle();
    expect(state(host)).toContain("current");
    expect(state(host)).not.toContain("stale");
  });

  it("keeps an edit made before hydration completes", async () => {
    let resolveRead!: (value: string | null) => void;
    const storage: AsyncRunConfigurationStorage = {
      get: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      set: async () => undefined,
    };
    const { host } = render({ storage, storageKey: "workspace:test" });
    await settle();
    await act(async () =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    resolveRead(JSON.stringify({ targetProfileId: "from-storage" }));
    await settle();
    expect(state(host)).toContain("edited");
    expect(state(host)).not.toContain("from-storage");
  });

  it("surfaces read failures and retries without losing the rendered form", async () => {
    let reads = 0;
    const storage: AsyncRunConfigurationStorage = {
      get: async () => {
        reads += 1;
        if (reads === 1) throw new Error("offline");
        return JSON.stringify({ targetProfileId: "recovered" });
      },
      set: async () => undefined,
    };
    const { host } = render({ storage, storageKey: "workspace:test" });
    await settle();
    expect(host.querySelector("[data-error]")?.textContent).toContain("Could not restore");
    await act(async () =>
      host.querySelectorAll("button")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await settle();
    expect(reads).toBe(2);
    expect(state(host)).toContain("recovered");
    expect(host.querySelector("[data-error]")?.textContent).toBe("");
  });

  it("serializes writes and retains the latest selection after a failed write", async () => {
    const writes: string[] = [];
    let releaseFirst!: () => void;
    let attempts = 0;
    const storage: AsyncRunConfigurationStorage = {
      get: async () => null,
      set: async (_key, value) => {
        writes.push(value);
        attempts += 1;
        if (attempts === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          throw new Error("storage full");
        }
        throw new Error("storage still full");
      },
    };
    const { host } = render({ storage, storageKey: "workspace:test" });
    await settle();
    const edit = host.querySelector("button");
    await act(async () => edit?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(writes).toHaveLength(1);
    await act(async () => {
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      releaseFirst();
    });
    await settle();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain("latest");
    expect(host.querySelector("[data-error]")?.textContent).toContain("Could not remember");
    expect(state(host)).toContain("latest");
  });

  it("exports an async hook API", () => {
    expect(usePersistedRunConfiguration).toBeTypeOf("function");
  });
});
