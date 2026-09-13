import assert from "node:assert/strict";
import test from "node:test";
import {
  dismissBrowserConsentIfPresent,
  installBrowserConsentOverlayHandler,
} from "./browser-consent-overlay.js";

test("installs one cookie-notice handler and reuses the same promise", async () => {
  const handlers: Array<{ name: string | undefined; clicks: string[]; noWaitAfter?: boolean }> = [];
  const buttons = new Map<string, { count: number }>([
    ["Reject All", { count: 1 }],
    ["Dismiss cookie notice", { count: 1 }],
  ]);
  const page = {
    getByRole(role: string, options?: { name?: string }) {
      if (role === "dialog") return { role, name: options?.name };
      return {
        async count() {
          return buttons.get(options?.name ?? "")?.count ?? 0;
        },
        first() {
          return {
            click: async () => {
              handlers[0]?.clicks.push(options?.name ?? "");
            },
          };
        },
      };
    },
    async addLocatorHandler(
      locator: { name?: string },
      handler: () => Promise<void>,
      options?: { noWaitAfter?: boolean },
    ) {
      handlers.push({ name: locator.name, clicks: [], noWaitAfter: options?.noWaitAfter });
      await handler();
    },
  };
  const first = installBrowserConsentOverlayHandler(page as never);
  const second = installBrowserConsentOverlayHandler(page as never);
  assert.equal(first, second);
  await first;
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0]?.name, "Cookie notice");
  assert.equal(handlers[0]?.noWaitAfter, true);
  assert.deepEqual(handlers[0]?.clicks, ["Reject All"]);
});

test("dismisses cookie chrome with Reject All before the intended tap", async () => {
  const clicks: string[] = [];
  let hidden = false;
  const page = {
    waitForTimeout: async () => undefined,
    getByRole(_role: string, options?: { name?: string }) {
      if (_role === "dialog") {
        return {
          async count() {
            return hidden ? 0 : 1;
          },
          first() {
            return {
              waitFor: async () => {
                hidden = true;
              },
            };
          },
        };
      }
      return {
        async count() {
          return options?.name === "Reject All" && !hidden ? 1 : 0;
        },
        first() {
          return {
            click: async () => {
              clicks.push(options?.name ?? "");
              hidden = true;
            },
          };
        },
      };
    },
    async addLocatorHandler() {
      return undefined;
    },
  };
  await dismissBrowserConsentIfPresent(page as never);
  assert.deepEqual(clicks, ["Reject All"]);
});

test("skips dismiss when the cookie dialog is absent", async () => {
  let clicked = false;
  const page = {
    waitForTimeout: async () => undefined,
    getByRole(_role: string, options?: { name?: string }) {
      if (_role === "dialog") return { count: async () => 0 };
      return {
        count: async () => 0,
        first() {
          return {
            click: async () => {
              clicked = true;
            },
          };
        },
      };
    },
    async addLocatorHandler() {
      return undefined;
    },
  };
  await dismissBrowserConsentIfPresent(page as never);
  assert.equal(clicked, false);
});

test("falls back to the dismiss control when Reject All is absent", async () => {
  const clicks: string[] = [];
  const page = {
    getByRole(_role: string, options?: { name?: string }) {
      if (_role === "dialog") return { name: options?.name };
      return {
        async count() {
          return options?.name === "Dismiss cookie notice" ? 1 : 0;
        },
        first() {
          return {
            click: async () => {
              clicks.push(options?.name ?? "");
            },
          };
        },
      };
    },
    async addLocatorHandler(_locator: unknown, handler: () => Promise<void>) {
      await handler();
    },
  };
  await installBrowserConsentOverlayHandler(page as never);
  assert.deepEqual(clicks, ["Dismiss cookie notice"]);
});
