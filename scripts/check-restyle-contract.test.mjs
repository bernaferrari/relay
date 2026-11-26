import assert from "node:assert/strict";
import test from "node:test";
import { classifyRestyle } from "./check-restyle-contract.mjs";

test("layout classes are legitimate composition", () => {
  for (const cls of [
    "w-full",
    "size-4",
    "min-w-0",
    "px-2",
    "-mx-1",
    "gap-1.5",
    "flex",
    "flex-1",
    "items-center",
    "justify-between",
    "grid",
    "truncate",
    "whitespace-nowrap",
    "absolute",
    "inset-0",
    "overflow-hidden",
    "leading-5",
    "order-2",
  ]) {
    assert.equal(classifyRestyle(cls), "layout", cls);
  }
});

test("typography size and alignment are layout-adjacent", () => {
  for (const cls of ["text-xs", "text-sm", "text-base", "text-left", "text-center"]) {
    assert.equal(classifyRestyle(cls), "layout", cls);
  }
});

test("visual classes are the loophole the contract bans", () => {
  for (const cls of [
    "bg-warning/5",
    "bg-background/60",
    "text-foreground",
    "text-muted-foreground",
    "rounded-lg",
    "rounded-xl",
    "shadow-lg",
    "ring-1",
    "border-warning/30",
    "border",
    "font-medium",
    "font-normal",
    "font-semibold",
    "opacity-50",
    "tracking-wide",
  ]) {
    assert.equal(classifyRestyle(cls), "visual", cls);
  }
});

test("variant prefixes do not hide visual restyles", () => {
  assert.equal(classifyRestyle("hover:bg-red-500"), "visual");
  assert.equal(classifyRestyle("dark:text-white"), "visual");
  assert.equal(classifyRestyle("hover:w-full"), "layout");
  assert.equal(classifyRestyle("max-sm:text-xs"), "layout");
});

test("utilities are neither layout nor loophole", () => {
  for (const cls of [
    "sr-only",
    "pointer-events-none",
    "cursor-pointer",
    "transition-colors",
    "select-none",
    "[-webkit-app-region:no-drag]",
  ]) {
    assert.equal(classifyRestyle(cls), "utility", cls);
  }
});

test("every grandfathered entry still classifies as visual", async () => {
  const { grandfatheredVisualRestyles } = await import("./check-restyle-contract.mjs");
  for (const entry of grandfatheredVisualRestyles) {
    const cls = entry.split("::")[1];
    assert.equal(
      classifyRestyle(cls),
      "visual",
      `${entry} no longer classifies as visual — prune it or fix the classifier`,
    );
  }
});
