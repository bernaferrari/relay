/** @jsxImportSource react */
import { Dialog, DialogContent, DialogTitle } from "@relay/ui-react/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("generated shadcn overlay portals", () => {
  it("portals Base UI layers into document.body", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <>
          <Dialog open>
            <DialogContent showCloseButton={false} data-testid="dialog">
              <DialogTitle>Test dialog</DialogTitle>
            </DialogContent>
          </Dialog>
          <DropdownMenu open>
            <DropdownMenuContent data-testid="menu">
              <DropdownMenuItem>Menu item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>,
      );
    });

    expect(document.body.querySelector("[data-testid='dialog']")).not.toBeNull();
    expect(document.body.querySelector("[data-testid='menu']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("dismisses a nested menu before its dialog", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    function NestedOverlays() {
      const [dialogOpen, setDialogOpen] = useState(true);

      return (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent showCloseButton={false} data-testid="dialog">
            <DialogTitle>Test dialog</DialogTitle>
            <DropdownMenu>
              <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
              <DropdownMenuContent data-testid="menu">
                <DropdownMenuItem>Menu item</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </DialogContent>
        </Dialog>
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
