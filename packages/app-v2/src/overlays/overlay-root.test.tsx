/** @jsxImportSource react */
import { Dialog, Menu, OverlayRoot } from "@relay/ui-react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared overlay root", () => {
  it("portals Base UI layers into one owned container", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <OverlayRoot>
          <Dialog.Root open>
            <Dialog.Portal>
              <Dialog.Backdrop />
              <Dialog.Viewport>
                <Dialog.Popup data-testid="dialog">
                  <Dialog.Title>Test dialog</Dialog.Title>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
          <Menu.Root open>
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup data-testid="menu">
                  <Menu.Item>Menu item</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </OverlayRoot>,
      );
    });

    const container = document.querySelector("[data-relay-overlay-root]");
    expect(container?.querySelector("[data-testid='dialog']")).not.toBeNull();
    expect(container?.querySelector("[data-testid='menu']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("dismisses a nested menu before its dialog", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function NestedOverlays() {
      const [dialogOpen, setDialogOpen] = useState(true);

      return (
        <OverlayRoot>
          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
            <Dialog.Portal>
              <Dialog.Backdrop />
              <Dialog.Viewport>
                <Dialog.Popup data-testid="dialog">
                  <Dialog.Title>Test dialog</Dialog.Title>
                  <Menu.Root>
                    <Menu.Trigger>Open menu</Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner>
                        <Menu.Popup data-testid="menu">
                          <Menu.Item>Menu item</Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </OverlayRoot>
      );
    }

    await act(async () => root.render(<NestedOverlays />));
    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(document.querySelector("[data-testid='menu']")).not.toBeNull();
    expect(document.querySelector("[data-testid='dialog']")).not.toBeNull();

    await act(async () => {
      document
        .querySelector("[data-testid='menu']")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector("[data-testid='menu']")).toBeNull();
    expect(document.querySelector("[data-testid='dialog']")).not.toBeNull();
    await act(async () => root.unmount());
  });
});
