import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { RelayBrand } from "./relay-brand";
import { GitHubMark } from "./github-mark";
import { ThemeToggle } from "./site-controls";
import { repositoryUrl } from "@/lib/site";

const navLink =
  "h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * Full-bleed like the docs header: the lockup lands on the same pixel as the
 * docs sidebar/mobile header, so moving between the site and docs never jumps.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 items-center justify-between gap-3 ps-4 pe-2.5 md:h-[69px] md:ps-[15px] md:pe-4">
        <Link href="/" aria-label="Relay home" className="flex rounded-md">
          <RelayBrand />
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1">
          <a href="#loop" className={`${navLink} hidden md:inline-flex`}>
            How it works
          </a>
          <a href="#agents" className={`${navLink} hidden md:inline-flex`}>
            Agents
          </a>
          <Link href="/docs" className={`${navLink} inline-flex`}>
            Docs
          </Link>
          <a
            href={repositoryUrl}
            className={`${navLink} inline-flex gap-2`}
            aria-label="Relay on GitHub"
          >
            <GitHubMark />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <ThemeToggle />
          <Link
            href="/docs/getting-started/first-test"
            className={buttonVariants({
              className:
                "ml-1 hidden h-9 rounded-full bg-ink px-4 text-ink-foreground hover:bg-ink/85 sm:inline-flex dark:bg-ink-foreground dark:text-ink dark:hover:bg-ink-foreground/90",
            })}
          >
            Get started <ArrowRight className="size-3.5" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
