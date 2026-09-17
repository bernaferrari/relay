import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { createBrowserContextFactory } from "./browser-context.js";
import { dismissBrowserConsentIfPresent } from "./browser-consent-overlay.js";
import { readTarget } from "./targets.js";
import type { BrowserAuthPageSnapshot } from "./browser-auth-health.js";

export async function inspectManagedBrowserAuthPage(input: {
  targetId: string;
  projectId: string;
  reference: string;
  url: string;
}): Promise<BrowserAuthPageSnapshot> {
  const target = await readTarget(input.targetId);
  if (!target?.browser) throw new Error("Managed browser target not found");
  const factory = createBrowserContextFactory(target);
  const profile = {
    ...browserCaseProfileForTarget(target),
    authenticationFixtureId: input.reference,
  };
  const handle = await factory.openProof(profile, { projectId: input.projectId, headless: true });
  try {
    const page = handle.context.pages()[0] ?? (await handle.context.newPage());
    if (page.url() === "about:blank") {
      await page.goto(input.url, { waitUntil: "domcontentloaded" });
    }
    await dismissBrowserConsentIfPresent(page);
    const body = page.locator("body");
    try {
      await body
        .filter({
          hasText: /ask anything|imagine|new chat|sign in|sign up|log in|continue with/i,
        })
        .waitFor({ timeout: 8_000 });
    } catch {
      // Classify from whatever rendered; missing markers become health error.
    }
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("button, [role='button'], a")]
        .map((element) =>
          (element.getAttribute("aria-label") || element.textContent || "")
            .replace(/\s+/gu, " ")
            .trim(),
        )
        .filter((text) => text.length > 0 && text.length < 120),
    );
    return {
      title: await page.title(),
      bodyText: (await body.count()) ? await body.innerText() : "",
      ...(labels.length ? { labels } : {}),
    };
  } finally {
    await handle.close();
  }
}
