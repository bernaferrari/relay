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

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: { default: "Relay — Test your app. See the proof.", template: "%s | Relay" },
  description: siteDescription,
  icons: { icon: "/relay-mark.svg" },
  openGraph: {
    title: "Relay — Test your app. See the proof.",
    description: siteDescription,
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Relay: Record a real flow. Replay it. Review the proof.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay — Test your app. See the proof.",
    description: siteDescription,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${inter.className} flex min-h-screen flex-col`}>
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
