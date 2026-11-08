import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@relay/ui-react/components/button";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-page flex-1 items-center gap-10 px-5 py-20 sm:px-8 md:grid-cols-[1fr_auto]"
      >
        <div className="grid justify-items-start gap-5">
          <span className="font-mono text-eyebrow font-medium text-ribbon-pink uppercase">
            404 · Page not found
          </span>
          <h1 className="font-display text-error-title font-semibold sm:text-error-title-wide">
            This flow has no
            <br />
            recorded step here.
          </h1>
          <p className="max-w-lg text-lede leading-relaxed text-muted-foreground">
            The link may have moved. The docs cover setup, workflows, and troubleshooting.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className={buttonVariants({
                className:
                  "h-12 rounded-full bg-ink px-6 text-ink-foreground hover:bg-ink/85 dark:bg-ink-foreground dark:text-ink dark:hover:bg-ink-foreground/90",
              })}
            >
              Open the docs <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/"
              className={buttonVariants({
                variant: "outline",
                className: "h-12 rounded-full px-5",
              })}
            >
              Back to Relay
            </Link>
          </div>
        </div>
        <Image
          src="/relay-loop.webp"
          alt=""
          width={320}
          height={320}
          aria-hidden
          className="animate-loop-drift hidden w-72 opacity-90 md:block motion-reduce:animate-none"
        />
      </main>
    </>
  );
}
