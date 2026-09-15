import type { Locator, Page } from "playwright-core";
import { LEGACY_POSITIONAL_BROWSER_REF_ERROR } from "./browser-locator-contract.js";

const HEADING_SCOPE_ROLES = ["dialog", "alertdialog", "region"] as const;
const NAMED_CONTROL_ROLES = [
  "button",
  "link",
  "option",
  "menuitem",
  "menuitemradio",
  "menuitemcheckbox",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "textbox",
  "combobox",
  "spinbutton",
] as const;

function quotedSelector(
  selector: string,
): { field: "identifier" | "label"; match: "exact" | "contains"; value: string } | null {
  const parsed = selector.match(/^(id|label)(\*?)="((?:\\.|[^"])*)"$/u);
  const match = parsed;
  if (!match) return null;
  return {
    field: match[1] === "id" ? "identifier" : "label",
    match: match[2] === "*" ? "contains" : "exact",
    value: (match[3] ?? "").replaceAll('\\"', '"'),
  };
}

function namedControlsIn(
  scope: Pick<Locator, "getByRole">,
  label: string,
  exact: boolean,
): Locator {
  const named = NAMED_CONTROL_ROLES.map((role) => scope.getByRole(role, { name: label, exact }));
  return named
    .slice(1)
    .reduce((all, next) => all.or(next), named[0]!)
    .filter({ visible: true });
}

function sameLocatorBox(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(left.x - right.x) <= 4 &&
    Math.abs(left.y - right.y) <= 4 &&
    Math.abs(left.width - right.width) <= 4 &&
    Math.abs(left.height - right.height) <= 4
  );
}

/** Dialog/region (or heading-family ancestor) named `heading` → unique named control.
 * Copies that share one location stay one control. Separate locations never coalesce. */
export async function headingScopedLabelLocator(
  page: Page,
  heading: string,
  label: string,
  exact = true,
): Promise<Locator> {
  const scopes: Locator[] = [];
  for (const role of HEADING_SCOPE_ROLES) {
    const found = page.getByRole(role, { name: heading, exact: true }).filter({ visible: true });
    const count = await found.count();
    for (let index = 0; index < count; index += 1) scopes.push(found.nth(index));
  }
  const headings = page
    .getByRole("heading", { name: heading, exact: true })
    .filter({ visible: true });
  const headingCount = await headings.count();
  for (let index = 0; index < headingCount; index += 1) {
    const ancestor = headings
      .nth(index)
      .locator('xpath=ancestor::*[@role="dialog" or @role="alertdialog" or @role="region"][1]');
    if ((await ancestor.count()) === 1) scopes.push(ancestor);
  }

  const unique: Array<{
    locator: Locator;
    box: { x: number; y: number; width: number; height: number };
  }> = [];
  for (const scope of scopes) {
    const controls = namedControlsIn(scope, label, exact);
    const count = await controls.count();
    if (count === 0) continue;
    if (count > 1) {
      throw new Error("Browser locator was ambiguous for heading-scoped label");
    }
    const box = await controls.boundingBox();
    if (!box) continue;
    if (unique.some((existing) => sameLocatorBox(existing.box, box))) continue;
    unique.push({ locator: controls, box });
  }
  if (unique.length === 0) {
    throw new Error("Browser locator did not match heading-scoped label");
  }
  if (unique.length > 1) {
    throw new Error("Browser locator was ambiguous for heading-scoped label");
  }
  return unique[0]!.locator;
}

async function locatorOnce(
  page: Page,
  input: { ref?: string; selector?: string; heading?: string },
) {
  if (input.ref) {
    throw new Error(LEGACY_POSITIONAL_BROWSER_REF_ERROR);
  }
  const parsed = input.selector ? quotedSelector(input.selector) : null;
  if (parsed) {
    if (parsed.field === "label") {
      // A control and its text child are one semantic target. Resolve named
      // controls first; two distinct controls with the same name still fail.
      const heading = input.heading?.trim();
      if (heading) {
        return headingScopedLabelLocator(page, heading, parsed.value, parsed.match === "exact");
      }
      const named = NAMED_CONTROL_ROLES.map((role) =>
        page.getByRole(role, { name: parsed.value, exact: parsed.match === "exact" }),
      );
      const controls = named
        .slice(1)
        .reduce((all, next) => all.or(next), named[0]!)
        .filter({ visible: true });
      const count = await controls.count();
      if (count > 1) throw new Error("Browser locator was ambiguous for label");
      if (count === 1) return controls;
    }
    const locator =
      parsed.field === "identifier"
        ? page.locator(
            `[id=${JSON.stringify(parsed.value)}], [data-testid=${JSON.stringify(parsed.value)}]`,
          )
        : page
            .getByLabel(parsed.value, { exact: parsed.match === "exact" })
            .or(page.getByText(parsed.value, { exact: parsed.match === "exact" }));
    const count = await locator.count();
    if (count === 0) throw new Error(`Browser locator did not match ${parsed.field}`);
    if (count > 1) throw new Error(`Browser locator was ambiguous for ${parsed.field}`);
    return locator.first();
  }
  throw new Error("browser interaction requires a recorded element or label");
}

export async function performBrowserFind(
  locator: { count: () => Promise<number>; click: () => Promise<unknown> },
  query: string,
  action?: string,
): Promise<{ ok: true; exists?: true }> {
  if (action === "exists") {
    if ((await locator.count()) === 0) throw new Error(`No match for ${query}`);
    return { ok: true, exists: true };
  }
  if (action === undefined || action === "press" || action === "click") {
    const count = await locator.count();
    if (count === 0) throw new Error(`No match for ${query}`);
    if (count > 1) throw new Error(`Ambiguous browser match for ${query}`);
    await locator.click();
    return { ok: true };
  }
  throw new Error(`unsupported browser find action: ${action}`);
}

/** Grok's composer puts `data-testid="chat-input"` on a wrapping div. Fill the
 * unique nested field instead of throwing after the mutation is dispatched. */
export async function fillBrowserLocator(
  locator: {
    fill: (text: string) => Promise<void>;
    locator: (selector: string) => {
      filter: (options: { visible: boolean }) => {
        count: () => Promise<number>;
        fill: (text: string) => Promise<void>;
      };
    };
  },
  text: string,
): Promise<void> {
  const nested = locator
    .locator(
      'textarea, input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), [contenteditable="true"], [role="textbox"]',
    )
    .filter({ visible: true });
  if ((await nested.count()) === 1) {
    await nested.fill(text);
    return;
  }
  await locator.fill(text);
}

export async function locatorFor(
  page: Page,
  input: { ref?: string; selector?: string; heading?: string },
) {
  const deadline = performance.now() + 5_000;
  for (;;) {
    try {
      return await locatorOnce(page, input);
    } catch (error) {
      // Only absence is retryable, and only before dispatch. Ambiguous or stale
      // identity must never be repaired by clicking a different control.
      if (
        !(error instanceof Error) ||
        !error.message.includes("did not match") ||
        performance.now() >= deadline
      )
        throw error;
      await page.waitForTimeout(100);
    }
  }
}
