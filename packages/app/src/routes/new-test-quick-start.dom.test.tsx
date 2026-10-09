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
  it("starts a local website as explicit Guest without reusing a remembered login", async () => {
    const onStart = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <NewTestQuickStart
          recent={[]}
          initialAddress="localhost:8793"
          initialAccount=""
          accountsFor={() => [
            { reference: "authfx:old-admin", name: "Previous admin", targetId: "old-fixture" },
          ]}
          rememberedAccount={() => "authfx:old-admin"}
          onStart={onStart}
        />,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLFormElement>('form[aria-label="Start a test"]')!.requestSubmit(),
    );
    expect(onStart).toHaveBeenCalledWith("http://localhost:8793/", undefined);
  });
  it("fills a recent website without starting or bypassing unavailable setup", async () => {
    const onStart = vi.fn();
    const onAddressChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <NewTestQuickStart
          recent={["https://shop.example/"]}
          setupStatus="unavailable"
          onStart={onStart}
          onAddressChange={onAddressChange}
        />,
      ),
    );
    const recent = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("shop.example"),
    )!;
    await act(async () => recent.click());
    expect(host.querySelector<HTMLInputElement>("#new-test-website")?.value).toBe(
      "https://shop.example/",
    );
    expect(onAddressChange).toHaveBeenCalledWith("https://shop.example/");
    expect(onStart).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
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
    const checked = document.querySelector("#new-test-account");
    expect(checked?.textContent).toContain("Staging admin");
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
      document.querySelector<HTMLButtonElement>("#new-test-account")!.click();
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent?.includes("Guest"))!
        .click();
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

describe("What should work?", () => {
  async function renderDescribe() {
    const onStart = vi.fn();
    const onDescribe = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <NewTestQuickStart
          recent={[]}
          initialAddress="shop.example"
          onStart={onStart}
          onDescribe={onDescribe}
        />,
      ),
    );
    const goal = host.querySelector<HTMLTextAreaElement>("#new-test-goal")!;
    const submit = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    async function type(value: string) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(goal, value);
        goal.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    return { host, goal, submit, type, onStart, onDescribe };
  }

  it("creates a test from a description with one primary action", async () => {
    const { host, submit, type, onStart, onDescribe } = await renderDescribe();
    expect(host.querySelector("h2")?.textContent).toBe("What should work?");
    expect(submit().textContent).toContain("Start recording");
    await type("Creating an API key shows it in the list");
    expect(submit().textContent).toContain("Create test");
    await act(async () =>
      host.querySelector<HTMLFormElement>('form[aria-label="Start a test"]')!.requestSubmit(),
    );
    expect(onDescribe).toHaveBeenCalledWith(
      "Creating an API key shows it in the list",
      "https://shop.example/",
      undefined,
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Record it instead");
  });

  it("records when the description is empty", async () => {
    const { host, onStart, onDescribe } = await renderDescribe();
    await act(async () =>
      host.querySelector<HTMLFormElement>('form[aria-label="Start a test"]')!.requestSubmit(),
    );
    expect(onStart).toHaveBeenCalledWith("https://shop.example/", undefined);
    expect(onDescribe).not.toHaveBeenCalled();
  });
});
