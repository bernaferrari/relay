/** Exercise authoring and Run destination controls before visual capture. */
export async function assertTestFixtureActions(page, fixture) {
  if (fixture.id === "test-detail") {
    const runOn = page.getByRole("button", { name: /^Run settings:/u });
    await runOn.click();
    const setup = page.getByRole("dialog", { name: "Run settings", exact: true });
    await setup.waitFor();
    const targetSelect = setup.getByRole("combobox", { name: "Browser", exact: true });
    if ((await targetSelect.count()) !== 1)
      throw new Error("Test detail did not render target setup");
    await targetSelect.click();
    const targets = page.getByRole("option");
    await targets.first().waitFor();
    const targetItemCount = await targets.count();
    if (targetItemCount !== 1) {
      throw new Error(
        `Browser Test offered an incompatible destination (items ${targetItemCount})`,
      );
    }
    await page.getByRole("option", { name: /Golden Chromium — Checkout staging/u }).click();
    if (await setup.getByRole("button", { name: "Run now", exact: true }).isDisabled()) {
      throw new Error("Test detail did not enable Run now after target selection");
    }
    if (
      !(await runOn.innerText()).includes("Run on") ||
      !(await runOn.innerText()).includes("Golden Chromium — Checkout staging")
    ) {
      throw new Error("Test detail did not expose the selected Run destination");
    }
    await runOn.click();
    await setup.waitFor({ state: "hidden" });
    const run = page.getByRole("button", { name: "Run", exact: true });
    if (
      (await run.isDisabled()) ||
      !(await run.getAttribute("aria-description"))?.includes("Golden Chromium — Checkout staging")
    ) {
      throw new Error("Test detail did not retain its Run destination after closing setup");
    }
  }
  if (fixture.recordingReview) {
    const actions = page.locator('ol[aria-label="Recorded actions"] > li');
    if ((await actions.count()) !== 4) {
      throw new Error("Recording review did not render every editable action");
    }
    await page.getByRole("button", { name: "Edit steps" }).click();
    // Save appears only while the instruction differs from what is saved.
    const save = page.getByRole("button", { name: "Save instruction", exact: true });
    const instruction = page.getByRole("textbox", { name: "What this step does", exact: true });
    await instruction.waitFor();
    if ((await save.count()) !== 0) {
      throw new Error("Recording review offered to save an unchanged instruction");
    }
    const originalInstruction = await instruction.inputValue();
    await instruction.fill(`${originalInstruction} again`);
    if ((await save.count()) !== 1 || (await save.isDisabled())) {
      throw new Error("Recording review did not offer to save a changed instruction");
    }
    await instruction.fill(originalInstruction);
    if ((await save.count()) !== 0) {
      throw new Error("Recording review kept a reverted instruction marked as changed");
    }
    const replay = page.getByRole("button", { name: "Run test", exact: true });
    if (
      (await replay.isDisabled()) ||
      (await replay.getAttribute("title")) !== "Replay on Managed browser"
    ) {
      throw new Error("Recording review did not expose replay on its recorded target");
    }
    if ((await page.getByRole("button", { name: "Save test", exact: true }).count()) !== 0) {
      throw new Error("Recording review offered to save before its required replay");
    }
  }
}
