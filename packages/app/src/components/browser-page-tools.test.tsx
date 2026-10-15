/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserAddressBar } from "./browser-address-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("scopes browser shortcuts, debounces Find and clears it on Escape", async () => {
  vi.useFakeTimers();
  const host = document.createElement("section"),
    other = document.createElement("input");
  document.body.append(host, other);
  const root = createRoot(host);
  const tools = vi.fn(async () => ({
    find: { query: "team", current: 1, total: 2, truncated: false },
  }));
  const key = (value: string, element: Element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, ctrlKey: true, bubbles: true, cancelable: true }),
    );
  try {
    await act(async () =>
      root.render(
        <BrowserAddressBar
          url="http://example.test"
          disabled={false}
          send={async () => true}
          tools={tools}
        />,
      ),
    );
    other.focus();
    await act(async () => key("f", other));
    expect(document.querySelector('[aria-label="Find in browser"]')).toBeNull();
    const address = host.querySelector<HTMLInputElement>('input[aria-label="Web address"]')!;
    address.focus();
    await act(async () => key("f", address));
    const find = host.querySelector<HTMLInputElement>('input[aria-label="Find on page"]')!;
    expect(document.activeElement).toBe(find);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(find, "team");
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(179));
    expect(tools).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(tools).toHaveBeenLastCalledWith({ kind: "browser.find", query: "team" });
    expect(host.textContent).toContain("1/2");
    await act(async () =>
      find.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(tools).toHaveBeenLastCalledWith({
      kind: "browser.find",
      query: "team",
      direction: "previous",
    });
    await act(async () =>
      find.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[aria-label="Find in browser"]')).toBeNull();
    expect(tools).toHaveBeenLastCalledWith({ kind: "browser.find", query: "" });
    address.focus();
    await act(async () => key("+", address));
    expect(tools).toHaveBeenLastCalledWith({ kind: "browser.zoom", factor: 1.1 });
    await act(async () => key("y", address));
    expect(tools).toHaveBeenCalledTimes(4); // Ctrl+Y remains redo; history is Ctrl+H.
    await act(async () => key("h", address));
    expect(tools).toHaveBeenLastCalledWith({ kind: "browser.history" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    other.remove();
    vi.useRealTimers();
  }
});

it("opens history immediately and keeps the filter typed while entries load", async () => {
  const host = document.createElement("section");
  document.body.append(host);
  const root = createRoot(host),
    send = vi.fn(async () => true);
  let resolveHistory!: (value: { history: { url: string; title: string }[] }) => void;
  const history = new Promise<{ history: { url: string; title: string }[] }>((resolve) => {
    resolveHistory = resolve;
  });
  try {
    await act(async () =>
      root.render(
        <BrowserAddressBar
          url="http://example.test"
          disabled={false}
          send={send}
          tools={async () => history}
        />,
      ),
    );
    const address = host.querySelector<HTMLInputElement>('input[aria-label="Web address"]')!;
    address.focus();
    await act(async () => {
      address.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Loading history…");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search history"]')!;
    expect(input.disabled).toBe(false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "second",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      resolveHistory({
        history: [
          { title: "First page", url: "http://example.test/first" },
          { title: "Second page", url: "http://example.test/second" },
        ],
      }),
    );
    expect(input.value).toBe("second");
    expect(document.body.textContent).not.toContain("First page");
    const second = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((row) =>
      row.textContent?.includes("Second page"),
    )!;
    await act(async () => second.click());
    expect(send).toHaveBeenLastCalledWith({ kind: "navigate", url: "http://example.test/second" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
