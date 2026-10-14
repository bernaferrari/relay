import { resolve } from "node:path";
import sharp from "sharp";
import { siteRoot } from "./content.mjs";

// Reuse the exact artwork shipped in Relay's macOS Icon Composer asset.
// Only resize/encode for the web; never redraw the brand.
const source = resolve(siteRoot, "../desktop/resources/Relay.icon/Assets/relay-loop.png");
await Promise.all([
  sharp(source)
    .resize(256, 256)
    .webp({ quality: 95 })
    .toFile(resolve(siteRoot, "public/relay-icon.webp")),
  sharp(source)
    .resize(1024, 1024)
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(resolve(siteRoot, "public/relay-loop.webp")),
  sharp(source).resize(48, 48).png().toFile(resolve(siteRoot, "public/favicon.png")),
  sharp(source).resize(180, 180).png().toFile(resolve(siteRoot, "public/apple-touch-icon.png")),
]);
console.log("Prepared Relay's native loop artwork for web and favicons.");
