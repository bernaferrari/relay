import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT_ROUTES = Object.freeze([
  "/home",
  "/apps",
  "/apps/:appId",
  "/apps/:appId/versions",
  "/apps/:appId/accounts",
  "/versions",
  "/accounts",
  "/apps/:appId/map",
  "/tests",
  "/tests/new",
  "/tests/:testId",
  "/tests/:testId/edit",
  "/tests/:testId/record",
  "/tests/:testId/run-across",
  "/suites",
  "/apps/:appId/suites/:suiteId",
  "/environments",
  "/environments/:profileId",
  "/sessions",
  "/sessions/:sessionId",
  "/recordings/:recordingId",
  "/recordings/:recordingId/review",
  "/runs",
  "/runs/:runId",
  "/batches/:batchId",
  "/changes",
  "/changes/:changeId",
  "/devices",
  "/devices/:deviceId",
  "/goals",
  "/prototype/workbench",
  "/debug",
  "/settings/general",
  "/settings/evidence",
  "/settings/integrations",
  "/settings/appearance",
  "/settings/advanced",
  "/settings/about",
]);

export const PRODUCT_PUBLIC_OBJECTS = Object.freeze([
  "App",
  "Test",
  "Run",
  "Change",
  "Device",
  "Session",
  "Plan",
  "Environment",
  "Checkpoint",
  "Report",
  "Proof",
  "Recording",
  "Data set",
  "Map",
]);

export const PRODUCT_ADVANCED_TERMS = Object.freeze([
  "App Map",
  "Take",
  "Variable",
  "Combine",
  "Cell",
  "World",
  "Lease",
  "Lens",
  "digest",
  "binding",
  "runtime profile",
  "plan digest",
  "publication receipt",
  "Campaign",
  "Connection",
]);

export const PRODUCT_OVERLAY_PRIORITY = Object.freeze([
  "menu",
  "popover",
  "inline editor",
  "dialog",
  "sheet",
  "temporary inspector",
  "canvas selection",
]);

export const PRODUCT_NARROW_WINDOW = Object.freeze({
  width: 800,
  height: 560,
  noHorizontalScroll: true,
});

/** Return advanced engine words found in ordinary UI copy. Callers should pass only
 * user-facing copy (not PRODUCT.md or Developer/Audit documentation). */
export function findProductAdvancedVocabulary(source = "") {
  return PRODUCT_ADVANCED_TERMS.filter((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "iu").test(source),
  );
}

const requiredSections = [
  "Promise and public model",
  "Canonical routes",
  "Interaction laws",
  "Responsive and accessibility contract",
  "Public vocabulary boundary",
  "One product shell",
];

export function evaluateProductContract({
  document,
  routes = PRODUCT_ROUTES,
  publicObjects = PRODUCT_PUBLIC_OBJECTS,
  advancedTerms = PRODUCT_ADVANCED_TERMS,
} = {}) {
  const violations = [];
  if (!document?.trim()) violations.push("PRODUCT.md is empty");
  for (const section of requiredSections)
    if (!document?.includes(`## ${section}`))
      violations.push(`PRODUCT.md is missing section: ${section}`);
  if (new Set(routes).size !== routes.length)
    violations.push("canonical routes contain duplicates");
  for (const route of PRODUCT_ROUTES)
    if (!routes.includes(route)) violations.push(`canonical route missing: ${route}`);
  for (const noun of PRODUCT_PUBLIC_OBJECTS)
    if (!publicObjects.includes(noun)) violations.push(`public object missing: ${noun}`);
  for (const term of PRODUCT_ADVANCED_TERMS)
    if (!advancedTerms.includes(term)) violations.push(`advanced term missing: ${term}`);
  for (const noun of publicObjects)
    if (advancedTerms.includes(noun))
      violations.push(`advanced term is incorrectly public: ${noun}`);
  if (PRODUCT_OVERLAY_PRIORITY.length !== 7)
    violations.push("overlay priority must contain seven layers");
  if (PRODUCT_NARROW_WINDOW.width !== 800 || PRODUCT_NARROW_WINDOW.height !== 560)
    violations.push("minimum narrow window must be 800x560");
  return violations;
}

export async function loadProductContract(
  root = resolve(fileURLToPath(new URL("..", import.meta.url))),
) {
  try {
    return await readFile(resolve(root, "PRODUCT.md"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = await loadProductContract();
  if (document == null) {
    console.log("Product contract skipped; PRODUCT.md is local-only and not present.");
  } else {
    const violations = evaluateProductContract({ document });
    if (violations.length) {
      console.error(violations.join("\n"));
      process.exitCode = 1;
    } else
      console.log(
        `Product contract passed (${PRODUCT_ROUTES.length} routes, ${PRODUCT_PUBLIC_OBJECTS.length} public objects)`,
      );
  }
}
