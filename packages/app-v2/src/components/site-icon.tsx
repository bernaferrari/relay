/** @jsxImportSource react */
import { useState } from "react";
import { Globe } from "lucide-react";

/** The website's own favicon, so a list of browsers reads like the sites they test. */
export function SiteIcon({ url, className = "size-5" }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const origin = siteOrigin(url);
  if (!origin) {
    return <Globe className={`${className} text-muted-foreground`} aria-hidden="true" />;
  }
  if (failed) {
    const host = siteHost(url) ?? "";
    const local = /^(127\.|localhost|\[::1\])/.test(host);
    return (
      <span
        aria-hidden="true"
        className={`${className} flex items-center justify-center rounded-md text-xs font-semibold ${
          local
            ? "bg-muted text-muted-foreground"
            : MONOGRAM_TONES[hash(host) % MONOGRAM_TONES.length]
        }`}
      >
        {local ? "L" : (host[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`${origin}/favicon.ico`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={`${className} rounded-sm object-contain`}
      onError={() => setFailed(true)}
    />
  );
}

export function siteHost(url?: string): string | undefined {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

const MONOGRAM_TONES = [
  "bg-brand-soft text-brand",
  "bg-success/15 text-success-foreground",
  "bg-warning/15 text-warning-foreground",
  "bg-destructive/12 text-destructive",
  "bg-foreground text-background",
] as const;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(result);
}

function siteOrigin(url?: string): string | undefined {
  try {
    if (!url) return undefined;
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}
