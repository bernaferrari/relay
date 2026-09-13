import type { Locator, Page } from "playwright-core";

const installed = new WeakMap<Page, Promise<void>>();

function cookieNotice(page: Page): Locator {
  return page.getByRole("dialog", { name: "Cookie notice" });
}

async function clickFirst(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) return false;
  try {
    await locator.first().click({ timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/** grok.com's cookie chrome is a dialog named "Cookie notice". The visible
 * dismiss that actually removes it is Reject All. The small X is often
 * named "Dismiss cookie notice" and leaves the dialog in the accessibility
 * tree, so Playwright's locator handler then burns the 5s click budget
 * waiting for hidden. */
async function dismissCookieNotice(page: Page): Promise<boolean> {
  if (await clickFirst(page.getByRole("button", { name: "Reject All" }))) return true;
  return clickFirst(page.getByRole("button", { name: "Dismiss cookie notice" }));
}

/** Cookie banners cover composer controls on fresh signed-out grok.com
 * Chromes. Identity already treats that chrome as non-identity. Playwright
 * must dismiss it before a tap, or Attach/Submit land on the overlay and the
 * mutation is outcome-unknown. */
export function installBrowserConsentOverlayHandler(page: Page): Promise<void> {
  const pending = installed.get(page);
  if (pending) return pending;
  const work = page
    .addLocatorHandler(
      cookieNotice(page),
      async () => {
        await dismissCookieNotice(page);
      },
      { noWaitAfter: true },
    )
    .catch(() => undefined);
  installed.set(page, work);
  return work;
}

/** Dismiss cookie chrome before the intended tap is marked dispatched, then
 * wait until layout reflow finishes. A locator handler alone clicks Dismiss
 * mid-Attach and leaves the composer click outcome-unknown. */
export async function dismissBrowserConsentIfPresent(page: Page): Promise<void> {
  await installBrowserConsentOverlayHandler(page);
  const dialog = cookieNotice(page);
  if ((await dialog.count()) === 0) return;
  await dismissCookieNotice(page);
  await dialog.first().waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

export function browserConsentOverlayLocator(page: Page): Locator {
  return cookieNotice(page);
}
