import type { Page } from "playwright-core";

/** Wait for rendered content, not network idle: chat streams and analytics may
 * never stop. A bounded quiet period also lets hydrated menus replace shells. */
export async function waitForBrowserContent(
  page: Page,
  options: { timeoutMs?: number; stableForMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const stableForMs = options.stableForMs ?? 250;
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
    if (state.busy || state.fonts === "loading" || signature !== previous) {
      stableSince = performance.now();
      previous = signature;
    } else if (performance.now() - stableSince >= stableForMs) return;
    await page.waitForTimeout(50);
  }
  throw new Error(
    "Browser content did not settle within the readiness timeout. Inspect the page for a loading state; no further action was dispatched.",
  );
}
