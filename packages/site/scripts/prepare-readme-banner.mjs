import { resolve } from "node:path";
import sharp from "sharp";
import { siteRoot } from "./content.mjs";

const width = 2560;
const height = 1104;
const loop = (
  await sharp(resolve(siteRoot, "../desktop/resources/Relay.icon/Assets/relay-loop.png"))
    .resize(820, 820)
    .png()
    .toBuffer()
).toString("base64");

const themes = {
  light: {
    background: "#f7f5f1",
    grid: "rgba(23, 27, 43, 0.055)",
    text: "#171b2b",
    muted: "#626675",
    tagFill: "rgba(255, 255, 255, 0.86)",
    tagStroke: "rgba(23, 27, 43, 0.08)",
    tagText: "#242837",
    tagMuted: "#696d7a",
    glowOpacity: "0.55",
  },
  dark: {
    background: "#101117",
    grid: "rgba(255, 255, 255, 0.045)",
    text: "#f4f3f0",
    muted: "#a7aab5",
    tagFill: "rgba(24, 25, 34, 0.88)",
    tagStroke: "rgba(255, 255, 255, 0.13)",
    tagText: "#f4f3f0",
    tagMuted: "#a7aab5",
    glowOpacity: "0.38",
  },
};

function svg(theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="ribbon" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#3a63f5"/><stop offset="0.4" stop-color="#8a4ff0"/>
      <stop offset="0.68" stop-color="#ec4f9a"/><stop offset="1" stop-color="#ff8a3d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#b56cff" stop-opacity="${theme.glowOpacity}"/>
      <stop offset="1" stop-color="#b56cff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M 64 0 L 0 0 0 64" fill="none" stroke="${theme.grid}" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="${theme.background}"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <circle cx="2040" cy="540" r="570" fill="url(#glow)"/>
  <image href="data:image/png;base64,${loop}" x="1625" y="135" width="820" height="820"/>

  <text x="140" y="325" font-family="Helvetica Neue, Arial, sans-serif" font-size="112" font-weight="700" letter-spacing="-4" fill="${theme.text}">Real eyes and hands</text>
  <text x="140" y="450" font-family="Helvetica Neue, Arial, sans-serif" font-size="112" font-weight="700" letter-spacing="-4" fill="url(#ribbon)">for coding agents.</text>

  <text x="140" y="570" font-family="Helvetica Neue, Arial, sans-serif" font-size="40" fill="${theme.muted}">
    <tspan x="140" dy="0">Keep plain-English Tests in Git.</tspan>
    <tspan x="140" dy="58">Deterministic replay at $0 model cost.</tspan>
    <tspan x="140" dy="58">Evidence stays on your machine.</tspan>
  </text>

  <g>
    <rect x="1570" y="310" width="342" height="66" rx="33" fill="${theme.tagFill}" stroke="${theme.tagStroke}"/>
    <circle cx="1605" cy="343" r="15" fill="#3a63f5"/>
    <text x="1632" y="353" font-family="Helvetica Neue, Arial, sans-serif" font-size="27" fill="${theme.tagMuted}"><tspan font-weight="700" fill="${theme.tagText}">You</tspan><tspan dx="9">write or record</tspan></text>
  </g>
  <g>
    <rect x="1995" y="762" width="430" height="66" rx="33" fill="${theme.tagFill}" stroke="${theme.tagStroke}"/>
    <circle cx="2030" cy="795" r="15" fill="#ff8a3d"/>
    <text x="2057" y="805" font-family="Helvetica Neue, Arial, sans-serif" font-size="27" fill="${theme.tagMuted}"><tspan font-weight="700" fill="${theme.tagText}">Your agent</tspan><tspan dx="9">runs the proof</tspan></text>
  </g>
</svg>`;
}

for (const [name, theme] of Object.entries(themes)) {
  await sharp(Buffer.from(svg(theme)))
    .webp({ quality: 92 })
    .toFile(resolve(siteRoot, `public/images/readme-banner-${name}.webp`));
}
console.log("Prepared README banners with Relay's native loop artwork.");
