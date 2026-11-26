import assert from "node:assert/strict";
import test from "node:test";
import {
  fillBrowserLocator,
  headingScopedLabelLocator,
  locatorFor,
} from "./browser-target-locator.js";
import type { Page } from "playwright-core";

type FakeBox = { x: number; y: number; width: number; height: number };
type FakeNode = {
  role: string;
  name: string;
  visible: boolean;
  box: FakeBox;
  children: FakeNode[];
  parent?: FakeNode;
};

function linkParents(node: FakeNode, parent?: FakeNode): FakeNode {
  node.parent = parent;
  for (const child of node.children) linkParents(child, node);
  return node;
}

function flatten(nodes: FakeNode[], acc: FakeNode[] = []): FakeNode[] {
  const seen = new Set(acc);
  const visit = (node: FakeNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    acc.push(node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return acc;
}

function roleMatches(live: string, query: string): boolean {
  return live === query;
}

function nameMatches(live: string, query: string | undefined, exact: boolean | undefined): boolean {
  if (!query) return true;
  return exact === false ? live.includes(query) : live === query;
}

function fakeLocator(nodes: FakeNode[]) {
  const self = {
    nodes,
    getByRole(role: string, options?: { name?: string; exact?: boolean }) {
      const pool = flatten(nodes);
      return fakeLocator(
        pool.filter(
          (node) =>
            roleMatches(node.role, role) && nameMatches(node.name, options?.name, options?.exact),
        ),
      );
    },
    filter(options: { visible: boolean }) {
      return fakeLocator(nodes.filter((node) => node.visible === options.visible));
    },
    or(other: { nodes: FakeNode[] }) {
      const seen = new Set(nodes);
      return fakeLocator([...nodes, ...other.nodes.filter((node) => !seen.has(node))]);
    },
    nth(index: number) {
      return fakeLocator(nodes[index] ? [nodes[index]!] : []);
    },
    async count() {
      return nodes.length;
    },
    locator(selector: string) {
      if (selector.includes("ancestor::*") && selector.includes("@role=")) {
        const roles = [...selector.matchAll(/@role="([^"]+)"/gu)].map((match) => match[1]!);
        const ancestors: FakeNode[] = [];
        for (const node of nodes) {
          let current = node.parent;
          while (current) {
            if (roles.includes(current.role)) {
              ancestors.push(current);
              break;
            }
            current = current.parent;
          }
        }
        return fakeLocator(ancestors);
      }
      return fakeLocator([]);
    },
    async boundingBox() {
      return nodes[0]?.box ?? null;
    },
  };
  return self;
}

function fakePage(roots: FakeNode[]) {
  const linked = roots.map((root) => linkParents(root));
  return fakeLocator(flatten(linked));
}

function buildModeTree(options?: { secondDialog?: boolean; twoDismissInDialog?: boolean }) {
  const financeDismiss: FakeNode = {
    role: "button",
    name: "Dismiss",
    visible: true,
    box: { x: 991, y: 382, width: 72, height: 32 },
    children: [],
  };
  const finance: FakeNode = {
    role: "region",
    name: "Finance",
    visible: true,
    box: { x: 469, y: 360, width: 600, height: 80 },
    children: [
      {
        role: "heading",
        name: "Finance",
        visible: true,
        box: { x: 469, y: 381, width: 308, height: 18 },
        children: [],
      },
      financeDismiss,
    ],
  };
  const buildDismiss: FakeNode = {
    role: "button",
    name: "Dismiss",
    visible: true,
    box: { x: 828, y: 596, width: 72, height: 32 },
    children: [],
  };
  const extraDismiss: FakeNode = {
    role: "button",
    name: "Dismiss",
    visible: true,
    box: { x: 900, y: 596, width: 72, height: 32 },
    children: [],
  };
  const dialog: FakeNode = {
    role: "dialog",
    name: "Introducing Build Mode",
    visible: true,
    box: { x: 824, y: 339, width: 320, height: 301 },
    children: [
      {
        role: "heading",
        name: "Introducing Build Mode",
        visible: true,
        box: { x: 840, y: 511, width: 288, height: 23 },
        children: [],
      },
      buildDismiss,
      ...(options?.twoDismissInDialog ? [extraDismiss] : []),
    ],
  };
  const otherDialog: FakeNode = {
    role: "dialog",
    name: "Introducing Build Mode",
    visible: true,
    box: { x: 20, y: 20, width: 200, height: 200 },
    children: [
      {
        role: "button",
        name: "Dismiss",
        visible: true,
        box: { x: 40, y: 160, width: 72, height: 32 },
        children: [],
      },
    ],
  };
  return fakePage([finance, dialog, ...(options?.secondDialog ? [otherDialog] : [])]);
}

function fillFakeLocator(options: {
  nested: number;
  wrapperFill?: (text: string) => Promise<void>;
}) {
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
  const fake = fillFakeLocator({ nested: 1 });
  await fillBrowserLocator(fake.locator, "3*5");
  assert.equal(fake.filled(), "nested:3*5");
});

test("fillBrowserLocator fills the wrapper when there is no nested field", async () => {
  const fake = fillFakeLocator({ nested: 0 });
  await fillBrowserLocator(fake.locator, "3*5");
  assert.equal(fake.filled(), "wrapper:3*5");
});

test("fillBrowserLocator does not guess among several nested fields", async () => {
  const fake = fillFakeLocator({
    nested: 2,
    wrapperFill: async () => {
      throw new Error("Element is not an <input>");
    },
  });
  await assert.rejects(fillBrowserLocator(fake.locator, "3*5"), /not an <input>/u);
});

test("heading-scoped Dismiss clicks Build Mode, not Finance", async () => {
  const page = buildModeTree();
  const locator = await headingScopedLabelLocator(
    page as never as Page,
    "Introducing Build Mode",
    "Dismiss",
  );
  assert.deepEqual(await locator.boundingBox(), { x: 828, y: 596, width: 72, height: 32 });
  const viaSelector = await locatorFor(page as never as Page, {
    selector: 'label="Dismiss"',
    heading: "Introducing Build Mode",
  });
  assert.deepEqual(await viaSelector.boundingBox(), { x: 828, y: 596, width: 72, height: 32 });
});

test("bare Dismiss stays ambiguous across Build Mode and Finance", async () => {
  const page = buildModeTree();
  await assert.rejects(
    locatorFor(page as never as Page, { selector: 'label="Dismiss"' }),
    /ambiguous for label/u,
  );
});

test("two Dismiss buttons under one Build Mode heading do not coalesce", async () => {
  const page = buildModeTree({ twoDismissInDialog: true });
  await assert.rejects(
    headingScopedLabelLocator(page as never as Page, "Introducing Build Mode", "Dismiss"),
    /ambiguous for heading-scoped label/u,
  );
});

test("two Introducing Build Mode dialogs do not coalesce their Dismiss buttons", async () => {
  const page = buildModeTree({ secondDialog: true });
  await assert.rejects(
    headingScopedLabelLocator(page as never as Page, "Introducing Build Mode", "Dismiss"),
    /ambiguous for heading-scoped label/u,
  );
});
