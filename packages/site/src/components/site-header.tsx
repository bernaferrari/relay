import Link from "next/link";
import { GitFork } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { RelayBrand } from "./relay-brand";
import { ThemeToggle } from "./site-controls";
import { repositoryUrl } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Link href="/" aria-label="Relay home">
          <RelayBrand />
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-5">
          <a
            href="#workflow"
            className="hidden text-sm text-muted-foreground hover:text-foreground md:inline-flex"
          >
            How it works
          </a>
          <Link
            href="/docs"
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
          >
            Docs
          </Link>
          <a
            href={repositoryUrl}
            aria-label="Relay on GitHub"
            className="inline-flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <GitFork className="size-4" />
          </a>
          <ThemeToggle />
          <span className="hidden lg:inline-flex">
            <Link
              href="/docs/getting-started/first-test"
              className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}
            >
              Get started
            </Link>
          </span>
        </nav>
      </div>
    </header>
  );
}
