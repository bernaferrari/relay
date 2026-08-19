import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanizeIdentifier, humanizeTitle, identifierControlPhrase } from "./humanize-identifier";

describe("humanizeIdentifier", () => {
  it("keeps the words and drops the widget noun", () => {
    assert.equal(humanizeIdentifier("settings_button"), "Settings");
    assert.equal(humanizeIdentifier("compose_new_message_btn"), "Compose new message");
  });
  it("strips the Android resource package", () => {
    assert.equal(humanizeIdentifier("ai.x.grok:id/settings_button"), "Settings");
    assert.equal(
      humanizeIdentifier("com.android.systemui:id/navigation_bar_frame"),
      "Navigation bar frame",
    );
  });
  it("splits camelCase written by the app author", () => {
    assert.equal(humanizeIdentifier("preferredLanguageRow"), "Preferred language");
  });
  it("keeps acronyms upper case", () => {
    assert.equal(humanizeIdentifier("URL_field"), "URL field");
  });
  it("says nothing when the identifier is only a widget noun", () => {
    assert.equal(humanizeIdentifier("button"), null);
    assert.equal(humanizeIdentifier("com.example:id/imageView"), null);
  });
  it("says nothing for hashes, refs and empty input", () => {
    assert.equal(humanizeIdentifier("a3f9c81be2d4"), null);
    assert.equal(humanizeIdentifier("0193847"), null);
    assert.equal(humanizeIdentifier("   "), null);
    assert.equal(humanizeIdentifier(undefined), null);
  });
});

describe("humanizeTitle", () => {
  it("rescues a screen saved under the identifier that was tapped to reach it", () => {
    assert.equal(humanizeTitle("settings_button"), "Settings");
    assert.equal(humanizeTitle("ai.x.grok:id/settings_button"), "Settings");
    assert.equal(humanizeTitle("preferredLanguageRow"), "Preferred language");
  });
  it("leaves names a person chose exactly as they wrote them", () => {
    for (const title of [
      "Customize Grok",
      "NSFW Preferences",
      "Ask",
      "Back",
      "Shared Conversations",
      "Sign-in",
    ]) {
      assert.equal(humanizeTitle(title), title);
    }
  });
  it("keeps the stored title when the identifier holds nothing recognisable", () => {
    assert.equal(humanizeTitle("a3f9c81be2d4"), "a3f9c81be2d4");
    assert.equal(humanizeTitle("com.example:id/imageView"), "com.example:id/imageView");
  });
});

describe("identifierControlPhrase", () => {
  it("names the control without quoting words nobody can read on screen", () => {
    assert.equal(identifierControlPhrase("settings_button"), "the Settings control");
  });
  it("declines rather than leaking the raw token", () => {
    assert.equal(identifierControlPhrase("a3f9c81be2d4"), null);
  });
});
