import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { siteRoot } from "./content.mjs";

const logo = (await readFile(resolve(siteRoot, "public/relay-mark.svg"))).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#fefcf8"/>
  <path d="M0 560H1200" stroke="#e5e5e5"/>
  <image href="data:image/svg+xml;base64,${logo}" x="76" y="58" width="52" height="52"/>
  <text x="144" y="96" font-family="sans-serif" font-size="34" font-weight="600" fill="#161d29">Relay</text>
  <text x="76" y="258" font-family="sans-serif" font-size="84" font-weight="600" letter-spacing="-4" fill="#161d29">Test your app.</text>
  <text x="76" y="356" font-family="sans-serif" font-size="84" font-weight="600" letter-spacing="-4" fill="#1957bb">See the proof.</text>
  <text x="80" y="428" font-family="sans-serif" font-size="26" fill="#737373">Record a real flow. Run it again. See the proof.</text>
  <text x="80" y="600" font-family="sans-serif" font-size="20" fill="#737373">Web · Android · iOS</text>
  <text x="930" y="600" font-family="sans-serif" font-size="20" fill="#737373">Open source. Local.</text>
  <rect x="936" y="170" width="180" height="275" rx="20" fill="#ffffff" stroke="#e5e5e5"/>
  <rect x="957" y="199" width="82" height="7" rx="3" fill="#dfe5ee"/>
  <rect x="957" y="232" width="138" height="40" rx="7" fill="#f5f5f5"/>
  <rect x="957" y="286" width="138" height="40" rx="7" fill="#f5f5f5"/>
  <rect x="957" y="340" width="138" height="40" rx="7" fill="#f5f5f5"/>
  <g stroke="#161d29" stroke-width="3" fill="none"><path d="m974 252 6 6 12-13"/><path d="m974 306 6 6 12-13"/><path d="m974 360 6 6 12-13"/></g>
  <rect x="1005" y="248" width="65" height="6" rx="3" fill="#d4d4d4"/>
  <rect x="1005" y="302" width="65" height="6" rx="3" fill="#d4d4d4"/>
  <rect x="1005" y="356" width="65" height="6" rx="3" fill="#d4d4d4"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(resolve(siteRoot, "public/og.png"));
console.log("Prepared 1200×630 social preview.");
