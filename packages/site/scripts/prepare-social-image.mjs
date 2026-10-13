import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { siteRoot } from "./content.mjs";

const logo = (await readFile(resolve(siteRoot, "public/apple-touch-icon.png"))).toString("base64");
const preview = (
  await sharp(resolve(siteRoot, "public/images/relay-run.webp")).png().toBuffer()
).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#ffffff"/>
  <image href="data:image/png;base64,${logo}" x="68" y="48" width="68" height="68"/>
  <text x="148" y="96" font-family="sans-serif" font-size="34" font-weight="600" fill="#161d29">Relay</text>
  <text x="76" y="214" font-family="sans-serif" font-size="18" letter-spacing="2" fill="#606673">YOUR LOCAL QA WORKSPACE</text>
  <text x="76" y="304" font-family="sans-serif" font-size="64" font-weight="600" letter-spacing="-3" fill="#161d29">Record a flow.</text>
  <text x="76" y="386" font-family="sans-serif" font-size="64" font-weight="600" letter-spacing="-3" fill="#1957bb">Make it repeatable.</text>
  <text x="80" y="448" font-family="sans-serif" font-size="23" fill="#606673">Web, Android, and iOS. For people and agents.</text>
  <defs><clipPath id="preview"><rect x="710" y="205" width="414" height="291" rx="10"/></clipPath></defs>
  <image href="data:image/png;base64,${preview}" x="710" y="205" width="414" height="291" clip-path="url(#preview)"/>
  <path d="M76 546H1124" stroke="#e0e3e7"/>
  <text x="80" y="592" font-family="sans-serif" font-size="20" fill="#606673">Record · Run · Review</text>
  <text x="922" y="592" font-family="sans-serif" font-size="20" fill="#606673">Open source. Local.</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(resolve(siteRoot, "public/og.png"));
console.log("Prepared social preview with Relay's native artwork and actual demo UI.");
