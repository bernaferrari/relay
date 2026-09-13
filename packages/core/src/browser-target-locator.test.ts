import assert from "node:assert/strict";
import test from "node:test";
import { fillBrowserLocator } from "./browser-target-locator.js";

function fakeLocator(options: { nested: number; wrapperFill?: (text: string) => Promise<void> }) {
  let filled = "";
  return {
    locator: {
      fill: async (text: string) => {
        if (options.wrapperFill) return options.wrapperFill(text);
        filled = `wrapper:${text}`;
      },
      locator: () => ({
        filter: () => ({
          count: async () => options.nested,
          fill: async (text: string) => {
            filled = `nested:${text}`;
          },
        }),
      }),
    },
    filled: () => filled,
  };
}

test("fillBrowserLocator fills a unique nested contenteditable without touching the wrapper", async () => {
  const fake = fakeLocator({ nested: 1 });
  await fillBrowserLocator(fake.locator, "3*5");
  assert.equal(fake.filled(), "nested:3*5");
});

test("fillBrowserLocator fills the wrapper when there is no nested field", async () => {
  const fake = fakeLocator({ nested: 0 });
  await fillBrowserLocator(fake.locator, "3*5");
  assert.equal(fake.filled(), "wrapper:3*5");
});

test("fillBrowserLocator does not guess among several nested fields", async () => {
  const fake = fakeLocator({
    nested: 2,
    wrapperFill: async () => {
      throw new Error("Element is not an <input>");
    },
  });
  await assert.rejects(fillBrowserLocator(fake.locator, "3*5"), /not an <input>/u);
});
