import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WalkthroughExport } from "./walkthrough-export";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("downloads each prepared export once without a second save action", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const run = vi.fn();
  const downloads: string[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  const render = async (file?: { href: string; fileName: string }) =>
    act(async () =>
      root.render(
        <StrictMode>
          <WalkthroughExport pending={false} run={run} file={file} />
        </StrictMode>,
      ),
    );
  try {
    await render();
    await act(async () => host.querySelector("button")!.click());
    expect(run).toHaveBeenCalledOnce();
    expect(downloads).toEqual([]);
    const file = { href: "blob:first", fileName: "walkthrough.html" };
    await render(file);
    await render({ ...file });
    expect(downloads).toEqual(["walkthrough.html"]);
    expect(host.textContent).not.toContain("Save walkthrough");
    await render({ href: "blob:second", fileName: "updated.html" });
    expect(downloads).toEqual(["walkthrough.html", "updated.html"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    click.mockRestore();
  }
});
