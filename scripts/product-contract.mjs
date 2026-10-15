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
  "Step",
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
