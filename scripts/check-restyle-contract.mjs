import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The restyle contract for ui-react components: `className` is a designed
 * escape hatch for layout only. Classes that change how a component LOOKS
 * (color, radius, shadow, ring, font weight) fork the design system per call
 * site; classes that change where it sits or how big it is are legitimate
 * composition. Existing visual overrides are debt grandfathered below —
 * growth fails, shrinkage asks the author to prune the list in the same change.
 */

const uiComponents = new Set([
  "Alert",
  "Badge",
  "Button",
  "Card",
  "Checkbox",
  "Collapsible",
  "Dialog",
  "DropdownMenu",
  "Empty",
  "Field",
  "Input",
  "Item",
  "Label",
  "Popover",
  "Progress",
  "RadioGroup",
  "ScrollArea",
  "Select",
  "Separator",
  "Sheet",
  "Sidebar",
  "Skeleton",
  "Slider",
  "Switch",
  "Tabs",
  "Textarea",
  "Toggle",
  "ToggleGroup",
  "Tooltip",
]);

const textSizes = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const textAligns = new Set(["left", "center", "right", "justify", "start", "end"]);

const layoutPatterns = [
  /^(size|w|h|min-w|max-w|min-h|max-h)-/,
  /^(p[xytrble]?|m[xytrble]?)-/,
  /^gap(-[xy])?(-|$)/,
  /^(flex|grid|inline-flex|inline-block|block|hidden|contents)(-|$)/,
  /^(items|justify|content|self|place)-/,
  /^(grow|shrink|basis|order|col|row)-/,
  /^space-[xy]-/,
  /^(absolute|relative|fixed|sticky|static)$/,
  /^(inset|top|left|right|bottom|z)-/,
  /^(overflow|overscroll)(-|$)/,
  /^(truncate|whitespace-)/,
  /^(flex-1|flex-auto|flex-none|flex-initial)$/,
  /^aspect-/,
  /^object-/,
  /^leading-/,
];

const utilityPatterns = [
  /^(sr-only|not-sr-only)$/,
  /^(pointer-events|cursor|select-none|select-text|resize|scroll)-/,
  /^(select-none|select-text)$/,
  /^transition(-|$)/,
  /^animate-/,
  /^duration-/,
  /^ease-/,
  /^delay-/,
  /^-/, // vendor-prefixed custom properties such as -webkit-app-region
  /^(outline-none|appearance-none)$/,
  /^\[/, // arbitrary properties such as [-webkit-app-region:no-drag]
];

const visualPatterns = [
  /^bg-/,
  /^rounded(-|$)/,
  /^shadow(-|$)/,
  /^ring(-|$)/,
  /^opacity-/,
  /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^tracking-/,
  /^border(-|$)/,
  /^outline-/,
  /^fill-/,
  /^stroke-/,
  /^decoration-/,
  /^blur-/,
  /^backdrop/,
];

function stripVariants(cls) {
  let out = cls;
  for (let i = 0; i < 4; i += 1) {
    const idx = out.indexOf(":");
    if (idx <= 0) break;
    const prefix = out.slice(0, idx);
    if (/^[a-z0-9[\]-]+$/.test(prefix)) out = out.slice(idx + 1);
    else break;
  }
  return out;
}

export function classifyRestyle(cls) {
  let base = stripVariants(cls);
  if (!base) return "utility";
  // Negative spacing utilities (-mx-1) carry the sign before the pattern.
  if (/^-[a-z]/.test(base) && !base.startsWith("-webkit") && !base.startsWith("--"))
    base = base.slice(1);
  if (/^text-/.test(base)) {
    const rest = base.slice(5);
    if (textSizes.has(rest) || textAligns.has(rest)) return "layout";
    return "visual";
  }
  for (const pattern of visualPatterns) if (pattern.test(base)) return "visual";
  for (const pattern of layoutPatterns) if (pattern.test(base)) return "layout";
  for (const pattern of utilityPatterns) if (pattern.test(base)) return "utility";
  return "utility";
}

const componentAlternation = [...uiComponents].join("|");
const usagePattern = new RegExp(
  "<(?:" +
    componentAlternation +
    ')(?:\\.[A-Z][A-Za-z]*)?\\s[^>]*?className=(?:"([^"]*)"|\\{`([^`]*)`\\})',
  "gs",
);

const excludedDirs = new Set(["node_modules", "dist", "build", "out", "coverage", ".vite"]);

async function tsxFiles(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await tsxFiles(path, found);
    else if (entry.isFile() && /\.(tsx|jsx)$/.test(entry.name) && !entry.name.endsWith(".test.tsx"))
      found.push(path);
  }
  return found;
}

export async function scanRestyleViolations(root, scanRoots) {
  const violations = [];
  for (const scanRoot of scanRoots) {
    let files;
    try {
      files = await tsxFiles(join(root, scanRoot));
    } catch {
      continue;
    }
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(usagePattern)) {
        const classValue = match[1] ?? match[2] ?? "";
        for (const cls of classValue.split(/\s+/)) {
          if (!cls || cls.includes("${")) continue;
          if (classifyRestyle(cls) === "visual") {
            violations.push(`${relative(root, file)}::${cls}`);
          }
        }
      }
    }
  }
  return violations.sort();
}

/**
 * Visual restyles that predate the contract. Each entry is exact debt:
 * removing the violation means removing the entry in the same change;
 * adding any new violation fails the check.
 */
export const grandfatheredVisualRestyles = Object.freeze([
  "packages/app/src/components/browser-address-bar.tsx::bg-background/60",
  "packages/app/src/components/filter-select.tsx::font-medium",
  "packages/app/src/components/filter-select.tsx::text-foreground",
  "packages/app/src/components/settings-model-key.tsx::text-muted-foreground",
  "packages/app/src/components/test-editor-step.tsx::font-medium",
  "packages/app/src/components/test-editor-wait.tsx::text-foreground",
  "packages/app/src/router/create-router.tsx::rounded-xl",
  "packages/app/src/routes/batch-plan-review.tsx::bg-card",
  "packages/app/src/routes/batch-plan-review.tsx::border",
  "packages/app/src/routes/batch-plan-review.tsx::border-border",
  "packages/app/src/routes/batch-plan-review.tsx::rounded-lg",
  "packages/app/src/routes/devices-page.tsx::bg-card",
  "packages/app/src/routes/devices-page.tsx::bg-transparent",
  "packages/app/src/routes/devices-page.tsx::border",
  "packages/app/src/routes/devices-page.tsx::border-border",
  "packages/app/src/routes/devices-page.tsx::font-normal",
  "packages/app/src/routes/devices-page.tsx::rounded-xl",
  "packages/app/src/routes/devices-page.tsx::text-muted-foreground",
  "packages/app/src/routes/environment-page.tsx::border-border",
  "packages/app/src/routes/environment-page.tsx::border-t",
  "packages/app/src/routes/map-page.tsx::bg-card",
  "packages/app/src/routes/map-page.tsx::border",
  "packages/app/src/routes/map-page.tsx::rounded-xl",
  "packages/app/src/routes/map-page.tsx::shadow-lg",
  "packages/app/src/routes/raw-evidence-disclosure.tsx::bg-muted/30",
  "packages/app/src/routes/raw-evidence-disclosure.tsx::rounded-lg",
  "packages/app/src/routes/recording-review-layout.tsx::border-border/60",
  "packages/app/src/routes/recording-review-layout.tsx::border-t",
  "packages/app/src/routes/recording-trim-panel.tsx::bg-muted",
  "packages/app/src/routes/recording-trim-panel.tsx::bg-primary/15",
  "packages/app/src/routes/recording-trim-panel.tsx::ring-1",
  "packages/app/src/routes/recording-trim-panel.tsx::ring-inset",
  "packages/app/src/routes/recording-trim-panel.tsx::ring-primary/30",
  "packages/app/src/routes/recording-trim-panel.tsx::rounded-md",
  "packages/app/src/routes/recording-trim-panel.tsx::rounded-sm",
  "packages/app/src/routes/review-recording-page.tsx::bg-transparent",
  "packages/app/src/routes/review-recording-page.tsx::border-transparent",
  "packages/app/src/routes/review-recording-page.tsx::dark:bg-transparent",
  "packages/app/src/routes/review-recording-page.tsx::focus-visible:border-ring",
  "packages/app/src/routes/review-recording-page.tsx::font-semibold",
  "packages/app/src/routes/review-recording-page.tsx::hover:border-border",
  "packages/app/src/routes/review-recording-page.tsx::tracking-tight",
  "packages/app/src/routes/run-capture-review-panel.tsx::bg-card",
  "packages/app/src/routes/run-capture-review-panel.tsx::border-muted-foreground/60",
  "packages/app/src/routes/run-capture-review-panel.tsx::dark:bg-card",
  "packages/app/src/routes/run-capture-review-panel.tsx::shadow-none",
  "packages/app/src/routes/settings-page.tsx::bg-warning/5",
  "packages/app/src/routes/settings-page.tsx::border",
  "packages/app/src/routes/settings-page.tsx::border-warning/30",
  "packages/app/src/routes/settings-page.tsx::rounded-lg",
]);

const scanRoots = ["packages/app/src", "packages/desktop/src"];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await scanRestyleViolations(repositoryRoot, scanRoots);
  const grandfathered = new Set(grandfatheredVisualRestyles);
  const fresh = violations.filter((violation) => !grandfathered.has(violation));
  const resolved = [...grandfathered].filter((entry) => !violations.includes(entry));
  if (fresh.length > 0) {
    console.error(
      "Visual restyles on ui components fork the design system per call site — use layout classes or extend the component variant:",
    );
    console.error(fresh.map((violation) => `- ${violation}`).join("\n"));
    process.exitCode = 1;
  } else if (resolved.length > 0) {
    console.error(
      "Visual restyles were fixed — prune them from grandfatheredVisualRestyles in the same change:",
    );
    console.error(resolved.map((violation) => `- ${violation}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Restyle contract passed (${violations.length} grandfathered visual restyles, layout restyles allowed)`,
    );
  }
}
