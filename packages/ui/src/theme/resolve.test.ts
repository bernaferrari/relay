import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveThemeVariant, themeToCss } from "./resolve.ts";
import relayTheme from "./themes/relay.json" with { type: "json" };
import type { DesktopTheme } from "./types.ts";

const theme = relayTheme as DesktopTheme;

test("theme injection leaves shadcn primary to globals.css", () => {
  const tokens = resolveThemeVariant(theme.light, false);
  assert.equal(tokens["button-primary-base"], "var(--primary)");
  assert.equal(tokens["button-primary-foreground"], "var(--primary-foreground)");
  assert.equal(tokens["primary"], undefined);

  const css = themeToCss(tokens);
  assert.doesNotMatch(css, /--primary:/);
  assert.match(css, /--button-primary-base: var\(--primary\)/);
});
