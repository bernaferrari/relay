import { resolve } from "node:path";
import sharp from "sharp";
import { siteRoot } from "./content.mjs";

const loop = (
  await sharp(resolve(siteRoot, "../desktop/resources/Relay.icon/Assets/relay-loop.png"))
    .resize(560, 560)
    .png()
    .toBuffer()
).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="ribbon" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#3a63f5"/><stop offset="0.4" stop-color="#8a4ff0"/>
      <stop offset="0.68" stop-color="#ec4f9a"/><stop offset="1" stop-color="#ff8a3d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#b56cff" stop-opacity="0.35"/><stop offset="1" stop-color="#b56cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#fbfaf7"/>
  <circle cx="960" cy="315" r="270" fill="url(#glow)"/>
  <image href="data:image/png;base64,${loop}" x="730" y="85" width="460" height="460"/>
  <text x="76" y="112" font-family="Helvetica Neue, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="-1" fill="#171b2b">Relay</text>
  <text x="72" y="300" font-family="Helvetica Neue, Arial, sans-serif" font-size="60" font-weight="700" letter-spacing="-3" fill="#171b2b">Click through it once.</text>
  <text x="72" y="380" font-family="Helvetica Neue, Arial, sans-serif" font-size="60" font-weight="700" letter-spacing="-3" fill="url(#ribbon)">Relay keeps checking.</text>
  <text x="76" y="450" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" fill="#5d6272">Local QA for web, Android, and iOS. For people and agents.</text>
  <text x="76" y="566" font-family="Menlo, monospace" font-size="18" letter-spacing="1" fill="#5d6272">OPEN SOURCE · MIT · RUNS ON YOUR MACHINE</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(resolve(siteRoot, "public/og.png"));
console.log("Prepared social preview with Relay's native loop artwork.");
