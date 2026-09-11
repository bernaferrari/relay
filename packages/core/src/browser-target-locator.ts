import type { Page } from "playwright-core";
import { LEGACY_POSITIONAL_BROWSER_REF_ERROR } from "./browser-locator-contract.js";

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

async function locatorOnce(page: Page, input: { ref?: string; selector?: string }) {
  if (input.ref) {
    throw new Error(LEGACY_POSITIONAL_BROWSER_REF_ERROR);
  }
  const parsed = input.selector ? quotedSelector(input.selector) : null;
  if (parsed) {
    if (parsed.field === "label") {
      // A control and its text child are one semantic target. Resolve named
      // controls first; two distinct controls with the same name still fail.
      const roles = [
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
      const named = roles.map((role) =>
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

export async function locatorFor(page: Page, input: { ref?: string; selector?: string }) {
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
