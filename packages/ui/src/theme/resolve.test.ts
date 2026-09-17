import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastRatio, hexToOklch } from "./color.ts";
import { resolveThemeVariant } from "./resolve.ts";
import relayTheme from "./themes/relay.json" with { type: "json" };
import type { DesktopTheme, HexColor } from "./types.ts";

const theme = relayTheme as DesktopTheme;

function hexToken(value: string | undefined): HexColor {
  assert.match(value ?? "", /^#[0-9a-fA-F]{6}$/);
  return value as HexColor;
}

test("Relay light buttons use ink, not electric blue, with readable on-primary", () => {
  const tokens = resolveThemeVariant(theme.light, false);
  const fill = hexToken(tokens["button-primary-base"]);
  const onFill = hexToken(tokens["button-primary-foreground"]);
  const hover = hexToken(tokens["button-primary-hover"]);
  const active = hexToken(tokens["button-primary-active"]);

  assert.notEqual(fill.toLowerCase(), "#1d4aff");
  assert.ok(hexToOklch(fill).l < 0.3, `light fill should be ink-dark, got ${fill}`);
  assert.ok(hexToOklch(onFill).l > 0.85, `on-primary should be near-white, got ${onFill}`);
  assert.ok(contrastRatio(onFill, fill) >= 7, `on-primary contrast ${contrastRatio(onFill, fill)}`);
  assert.notEqual(hover, fill);
  assert.notEqual(active, fill);
});

test("Relay dark buttons invert to a light fill with dark on-primary", () => {
  const tokens = resolveThemeVariant(theme.dark, true);
  const fill = hexToken(tokens["button-primary-base"]);
  const onFill = hexToken(tokens["button-primary-foreground"]);

  assert.ok(hexToOklch(fill).l > 0.8, `dark fill should be near-white, got ${fill}`);
  assert.ok(hexToOklch(onFill).l < 0.3, `on-primary should be ink-dark, got ${onFill}`);
  assert.ok(contrastRatio(onFill, fill) >= 7, `on-primary contrast ${contrastRatio(onFill, fill)}`);
});
