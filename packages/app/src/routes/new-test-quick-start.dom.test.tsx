/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTestQuickStart } from "./new-test-quick-start";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

describe("New test as this account", () => {
  it("starts with the account's website and login already chosen", async () => {
    const onStart = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const accounts = [
      { reference: "authfx:buyer:1", name: "Staging buyer", targetId: "shop" },
      { reference: "authfx:admin:1", name: "Staging admin", targetId: "shop" },
    ];
    await act(async () => {
      root!.render(
        <NewTestQuickStart
          recent={[]}
          initialAddress="https://shop.example/"
          initialAccount="authfx:admin:1"
          accountsFor={() => accounts}
          rememberedAccount={() => "authfx:buyer:1"}
          onStart={onStart}
          onUseDevice={() => undefined}
        />,
      );
    });

    expect(document.querySelector<HTMLInputElement>('[aria-label="Website address"]')?.value).toBe(
      "https://shop.example/",
    );
    const checked = document.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toBe("Staging admin");
    await act(async () => {
      document.querySelector<HTMLFormElement>('form[aria-label="Start a test"]')!.requestSubmit();
    });
    expect(onStart).toHaveBeenCalledWith("https://shop.example/", accounts[1]);
  });

  it("keeps an unavailable account selected and blocks an implicit Guest start", async () => {
    const onStart = vi.fn();
    const onRetrySetup = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = async (setupStatus: "unavailable" | "ready") => {
      await act(async () => {
        root!.render(
          <NewTestQuickStart
            recent={[]}
            initialAddress="https://shop.example/"
            initialAccount="authfx:member:1"
            setupStatus={setupStatus}
            onRetrySetup={onRetrySetup}
            accountsFor={() => []}
            onStart={onStart}
            onUseDevice={() => undefined}
          />,
        );
      });
    };
    await render("unavailable");
    expect(document.body.textContent).toContain("could not be loaded");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(onStart).not.toHaveBeenCalled();

    await render("ready");
    expect(document.body.textContent).toContain("selected account is unavailable");
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="radio"]')?.click();
    });
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      false,
    );
    await act(async () => {
      document.querySelector<HTMLFormElement>('form[aria-label="Start a test"]')!.requestSubmit();
    });
    expect(onStart).toHaveBeenCalledWith("https://shop.example/", undefined);
  });
});
