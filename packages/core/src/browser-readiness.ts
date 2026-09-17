import type { Page } from "playwright-core";

const DEFAULT_CONTENT_TIMEOUT_MS = 20_000;
const DEFAULT_STABLE_FOR_MS = 250;

/** Next.js and similar shells paint skip-links before the app hydrates. */
export function browserContentLooksHydrated(text: string): boolean {
  const compact = text.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  const withoutSkip = compact.replace(/skip to (?:main )?content/gu, "").trim();
  return withoutSkip.length > 0 && !/^(?:loading|please wait)[.…! ]*$/u.test(withoutSkip);
}

/** Wait for rendered content, not network idle: chat streams and analytics may
 * never stop. A bounded quiet period also lets hydrated menus replace shells. */
export async function waitForBrowserContent(
  page: Page,
  options: { timeoutMs?: number; stableForMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONTENT_TIMEOUT_MS;
  const stableForMs = options.stableForMs ?? DEFAULT_STABLE_FOR_MS;
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  const started = performance.now();
  let previous = "";
  let stableSince = started;
  while (performance.now() - started < timeoutMs) {
    const state = await page.evaluate(() => ({
      text: document.body?.innerText ?? "",
      busy: Boolean(document.querySelector('[aria-busy="true"]')),
      fonts: document.fonts.status,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    const signature = JSON.stringify(state);
    const shell = !browserContentLooksHydrated(state.text);
    if (state.busy || state.fonts === "loading" || shell || signature !== previous) {
      stableSince = performance.now();
      previous = signature;
    } else if (performance.now() - stableSince >= stableForMs) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    "Browser content did not settle within the readiness timeout. Inspect the page for a loading state; no further action was dispatched.",
  );
}
