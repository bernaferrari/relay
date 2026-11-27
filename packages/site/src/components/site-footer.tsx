import Link from "next/link";
import { RelayBrand } from "./relay-brand";
import { repositoryUrl } from "@/lib/site";

const container = "mx-auto w-full max-w-page px-5 sm:px-8";
const eyebrow = "font-mono text-eyebrow font-medium uppercase";

export function SiteFooter() {
  const columns = [
    {
      title: "Product",
      links: [
        ["How it works", "/#loop"],
        ["For agents", "/#agents"],
        ["Compare: Revyl", "/compare/revyl"],
        ["Compare: Maestro", "/compare/maestro"],
        ["Compare: Playwright", "/compare/playwright"],
        ["Your first test", "/docs/getting-started/first-test"],
      ],
    },
    {
      title: "Guides",
      links: [
        ["Install", "/docs/getting-started/installation"],
        ["Next.js", "/docs/frameworks/nextjs"],
        ["Expo and React Native", "/docs/frameworks/expo"],
        ["Tests as YAML", "/docs/agents/test-files"],
        ["Connect over MCP", "/docs/agents/mcp"],
      ],
    },
    {
      title: "Project",
      links: [
        ["GitHub", repositoryUrl],
        ["Feedback", `${repositoryUrl}/issues`],
        ["MIT license", `${repositoryUrl}/blob/main/LICENSE`],
      ],
    },
  ];
  return (
    <footer className="border-t">
      <div className={`${container} grid gap-10 py-14 sm:grid-cols-[1.4fr_repeat(3,1fr)]`}>
        <div>
          <Link href="/" aria-label="Relay home" className="inline-flex rounded-md">
            <RelayBrand />
          </Link>
          <p className="mt-3 max-w-64 text-sm leading-relaxed text-muted-foreground">
            Local verification for coding agents.
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title} className="text-sm">
            <p className={`${eyebrow} text-muted-foreground`}>{col.title}</p>
            <ul className="mt-3">
              {col.links.map(([label, href]) => (
                <li key={label}>
                  <a
                    href={href}
                    className="inline-flex min-h-9 items-center text-foreground/80 hover:text-foreground"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
