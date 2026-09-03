import { expect, test } from "vitest";
import { readRememberedTestSelection, rememberTestSelection } from "./studio-shell-preferences";

test("each App Map restores its own last open Test", () => {
  localStorage.clear();
  rememberTestSelection("checkout", "older-checkout-test");
  rememberTestSelection("settings", "settings-language");

  expect(readRememberedTestSelection("checkout")).toBe("older-checkout-test");
  expect(readRememberedTestSelection("settings")).toBe("settings-language");
});
