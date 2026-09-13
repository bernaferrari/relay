/** Truthful names for grok-web smokes that only inspect chrome.
 * Live App Map ids stay as recorded; this catalog is the git-side coverage map.
 * Do not treat these as Switch models / Dismiss upsell / Persist setting. */

export type GrokWebSmokeCatalogEntry = {
  readonly id: string;
  readonly name: string;
  readonly doesNot: string;
};

export const GROK_WEB_SMOKE_CATALOG: readonly GrokWebSmokeCatalogEntry[] = [
  {
    id: "test-grok-web-signed-in-hide-upsell",
    name: "Inspect upsell",
    doesNot: "Dismiss upsell",
  },
  {
    id: "test-grok-web-signed-in-model-iterate",
    name: "Inspect model choices",
    doesNot: "Switch models",
  },
  {
    id: "test-grok-web-signed-in-settings",
    name: "Open settings panel",
    doesNot: "Persist setting",
  },
];

export const GROK_WEB_COVERAGE_GAPS = [
  "Switch models",
  "Dismiss upsell",
  "Persist setting",
] as const;

export function truthfulGrokWebSmokeName(testId: string): string | undefined {
  return GROK_WEB_SMOKE_CATALOG.find((item) => item.id === testId)?.name;
}
