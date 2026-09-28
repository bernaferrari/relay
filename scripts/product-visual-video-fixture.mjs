/** Seek to one decoded frame so the visual baseline measures the report UI. */
export async function prepareReportVideoFixture(page) {
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video instanceof HTMLVideoElement && video.readyState >= 2 && video.duration > 0;
  });
  await page.getByRole("button", { name: "Confirmation timeout", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return (
      video instanceof HTMLVideoElement && !video.seeking && Math.abs(video.currentTime - 2) < 0.1
    );
  });
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return;
    video.pause();
    video.currentTime = 2;
    if (video.seeking) {
      await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const main = document.querySelector("#main-content");
    if (main) main.scrollTop = 0;
  });
}
