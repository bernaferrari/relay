import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browserUploadLocatorInput, fulfillBrowserUpload } from "./browser-live-controls.js";

describe("browser upload", () => {
  it("sets files on a labeled input without opening a chooser", async () => {
    const calls: string[] = [];
    await fulfillBrowserUpload(
      "tests/fixtures/sample.pdf",
      { label: "Attach file" },
      {
        tryLabelInput: async (label) => {
          calls.push(`label:${label}`);
          return true;
        },
        tryHiddenInput: async () => {
          calls.push("hidden");
          return false;
        },
        clickSemanticTarget: async () => {
          calls.push("click");
        },
        waitForFileChooser: async () => {
          calls.push("chooser");
          return undefined;
        },
      },
    );
    assert.deepEqual(calls, ["label:Attach file"]);
  });

  it("clicks a menuitem then fulfills the file chooser", async () => {
    const calls: string[] = [];
    let files: string | undefined;
    await fulfillBrowserUpload(
      "tests/fixtures/sample.pdf",
      { label: "Upload a file" },
      {
        tryLabelInput: async () => false,
        tryHiddenInput: async () => {
          calls.push("hidden");
          return false;
        },
        clickSemanticTarget: async (target) => {
          calls.push(`click:${target.label}`);
        },
        waitForFileChooser: async () => {
          calls.push("arm-chooser");
          return {
            setFiles: async (next) => {
              files = Array.isArray(next) ? next[0] : next;
              calls.push("set-files");
            },
          };
        },
      },
    );
    assert.equal(files, "tests/fixtures/sample.pdf");
    assert.deepEqual(calls, ["arm-chooser", "click:Upload a file", "set-files"]);
  });

  it("fails closed when a labeled attach control does not open a chooser", async () => {
    await assert.rejects(
      () =>
        fulfillBrowserUpload(
          "tests/fixtures/sample.pdf",
          { label: "Upload a file" },
          {
            tryLabelInput: async () => false,
            tryHiddenInput: async () => false,
            clickSemanticTarget: async () => {},
            waitForFileChooser: async () => undefined,
          },
        ),
      /file chooser did not open/,
    );
  });

  it("quotes identifier and label selectors for the semantic locator", () => {
    assert.deepEqual(browserUploadLocatorInput({ identifier: 'id"x' }), {
      selector: 'id="id\\"x"',
    });
    assert.deepEqual(browserUploadLocatorInput({ label: "Upload a file" }), {
      selector: 'label="Upload a file"',
    });
  });
});
