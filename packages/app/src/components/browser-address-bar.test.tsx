/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserAddressBar, browserAddress } from "./browser-address-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("accepts local and public addresses but rejects executable schemes", () => {
  expect(browserAddress("localhost:5173")).toBe("http://localhost:5173/");
  expect(browserAddress("127.0.0.1:5173/path")).toBe("http://127.0.0.1:5173/path");
  expect(browserAddress("example.com")).toBe("https://example.com/");
  expect(browserAddress("http://example.com/page")).toBe("http://example.com/page");
  for (const value of ["javascript:alert(1)", "file:///tmp/test", "data:text/html,hi", ""]) {
    expect(() => browserAddress(value)).toThrow();
  }
});

it("submits the address and routes browser history controls", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const send = vi.fn(async () => true);
  try {
    await act(async () =>
      root.render(<BrowserAddressBar url="http://localhost:5173/" disabled={false} send={send} />),
    );
    expect(host.querySelector("input")?.value).toBe("http://localhost:5173/");
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(send).toHaveBeenLastCalledWith({ kind: "navigate", url: "http://localhost:5173/" });
    for (const [label, direction] of [
      ["Back", "back"],
      ["Forward", "forward"],
      ["Reload", "reload"],
    ]) {
      await act(async () => {
        host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
      });
      expect(send).toHaveBeenLastCalledWith({ kind: "history", direction });
    }
    await act(async () =>
      root.render(<BrowserAddressBar url="https://example.com/next" disabled={true} send={send} />),
    );
    expect(host.querySelector("input")?.value).toBe("https://example.com/next");
    const count = send.mock.calls.length;
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(send).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
