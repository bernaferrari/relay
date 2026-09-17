import { access } from "node:fs/promises";
import type { Browser } from "playwright-core";
import { chromium } from "playwright-core";
import { mintSeededMemberSession, SEEDED_MEMBER_SESSION_COOKIE } from "./seeded-member-app.js";

export const SEEDED_MEMBER_CHROME =
  process.env.RELAY_TEST_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function seededMemberChromePath(): Promise<string | undefined> {
  try {
    await access(SEEDED_MEMBER_CHROME);
    return SEEDED_MEMBER_CHROME;
  } catch {
    return undefined;
  }
}

/** HTML hashes and 1×1 placeholders are not capture acceptance. */
export function assertSeededMemberPng(png: Buffer, label = "Seeded Member capture"): void {
  if (png.length < 2_048 || !png.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`${label} is not a persisted PNG`);
  }
}

export async function withSeededMemberBrowser<T>(
  chromePath: string,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function captureSeededMemberSettingsPng(input: {
  url: string;
  role: "member" | "admin";
  viewport: { width: number; height: number };
  locale: string;
  browser: Browser;
}): Promise<Buffer> {
  const context = await input.browser.newContext({
    viewport: input.viewport,
    locale: input.locale,
    extraHTTPHeaders: { "accept-language": input.locale },
  });
  try {
    await context.addCookies([
      {
        name: SEEDED_MEMBER_SESSION_COOKIE,
        value: mintSeededMemberSession(input.role),
        url: input.url,
      },
    ]);
    const page = await context.newPage();
    await page.goto(new URL("/settings", input.url).href, { waitUntil: "networkidle" });
    await page.locator("#save-settings").waitFor();
    const png = Buffer.from(await page.screenshot({ type: "png" }));
    assertSeededMemberPng(png, `${input.role} ${input.viewport.width}×${input.viewport.height}`);
    return png;
  } finally {
    await context.close();
  }
}
