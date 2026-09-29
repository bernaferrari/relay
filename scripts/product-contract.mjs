import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_DEFINITIONS } from "../packages/product/src/routes.ts";

export const PRODUCT_ROUTES = Object.freeze(ROUTE_DEFINITIONS.map(({ id }) => id));

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

function sectionTerms(document, heading, separator) {
  const section = document?.split(`## ${heading}\n`)[1]?.split(/^## /mu)[0];
  const codeBlock = section?.match(/```text\n([\s\S]*?)\n```/u)?.[1];
  return (
    codeBlock
      ?.split(separator)
      .map((term) => term.trim())
      .filter(Boolean) ?? []
  );
}

export function evaluateProductContract({
  document,
  routes = PRODUCT_ROUTES,
  publicObjects = PRODUCT_PUBLIC_OBJECTS,
  advancedTerms = PRODUCT_ADVANCED_TERMS,
} = {}) {
  const violations = [];
  if (!document?.trim()) violations.push("PRODUCT_CONTRACT.md is empty");
  for (const section of requiredSections)
    if (!document?.includes(`## ${section}`))
      violations.push(`PRODUCT_CONTRACT.md is missing section: ${section}`);
  if (new Set(routes).size !== routes.length)
    violations.push("canonical routes contain duplicates");
  for (const route of PRODUCT_ROUTES)
    if (!routes.includes(route)) violations.push(`canonical route missing: ${route}`);
  const documentedRoutes = sectionTerms(document, "Canonical routes", /\n/u);
  if (new Set(documentedRoutes).size !== documentedRoutes.length)
    violations.push("documented routes contain duplicates");
  for (const route of routes)
    if (!documentedRoutes.includes(route)) violations.push(`documented route missing: ${route}`);
  for (const route of documentedRoutes)
    if (!routes.includes(route)) violations.push(`documented route is not registered: ${route}`);
  for (const noun of PRODUCT_PUBLIC_OBJECTS)
    if (!publicObjects.includes(noun)) violations.push(`public object missing: ${noun}`);
  for (const noun of publicObjects)
    if (!document?.includes(`**${noun}**`))
      violations.push(`documented public object missing: ${noun}`);
  for (const term of PRODUCT_ADVANCED_TERMS)
    if (!advancedTerms.includes(term)) violations.push(`advanced term missing: ${term}`);
  const documentedAdvancedTerms = sectionTerms(document, "Public vocabulary boundary", /,/u);
  for (const term of advancedTerms)
    if (!documentedAdvancedTerms.includes(term))
      violations.push(`documented advanced term missing: ${term}`);
  for (const term of documentedAdvancedTerms)
    if (!advancedTerms.includes(term))
      violations.push(`documented advanced term is not registered: ${term}`);
  for (const noun of publicObjects)
    if (advancedTerms.includes(noun))
      violations.push(`advanced term is incorrectly public: ${noun}`);
  if (!document?.replace(/\s+/gu, " ").includes(PRODUCT_OVERLAY_PRIORITY.join(", ")))
    violations.push("documented overlay priority differs from the product contract");
  if (!document?.includes(`${PRODUCT_NARROW_WINDOW.width}×${PRODUCT_NARROW_WINDOW.height}`))
    violations.push("documented minimum window differs from the product contract");
  return violations;
}

export async function loadProductContract(
  root = resolve(fileURLToPath(new URL("..", import.meta.url))),
) {
  return readFile(resolve(root, "PRODUCT_CONTRACT.md"), "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = await loadProductContract();
  const violations = evaluateProductContract({ document });
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Product contract passed (${PRODUCT_ROUTES.length} routes, ${PRODUCT_PUBLIC_OBJECTS.length} public objects)`,
    );
}
