import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import localFont from "next/font/local";
import { siteDescription, siteOrigin } from "@/lib/site";
import "./globals.css";

const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  display: "swap",
  weight: "100 900",
  variable: "--font-site-sans",
  fallback: ["Arial", "sans-serif"],
});

const display = localFont({
  src: "../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2",
  display: "swap",
  weight: "200 800",
  variable: "--font-site-display",
  fallback: ["Inter", "Arial", "sans-serif"],
});

const mono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  display: "swap",
  weight: "100 800",
  variable: "--font-site-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "Relay — Click through it once. Relay keeps checking.",
    template: "%s | Relay",
  },
  description: siteDescription,
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Relay — Click through it once. Relay keeps checking.",
    description: siteDescription,
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Relay: Click through it once. Relay keeps checking.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay — Click through it once. Relay keeps checking.",
    description: siteDescription,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${display.variable} ${mono.variable} ${inter.className} flex min-h-screen flex-col`}
      >
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <RootProvider
          theme={{ defaultTheme: "light", enableSystem: false, disableTransitionOnChange: true }}
          search={{
            options: { type: "static", api: "/api/search" },
            links: [
              ["Your first test", "/docs/getting-started/first-test"],
              ["Connect a device", "/docs/devices/android"],
              ["Troubleshooting", "/docs/reference/troubleshooting"],
            ],
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
