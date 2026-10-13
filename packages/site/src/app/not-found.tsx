import Link from "next/link";
import { buttonVariants } from "@relay/ui-react/components/button";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-6xl px-5 sm:px-8 grid min-h-96 content-center justify-items-start gap-5 py-20"
    >
      <span className="text-sm text-muted-foreground">404 · Page not found</span>
      <h1 className="text-4xl font-semibold tracking-tight">Let's get you back on track.</h1>
      <p className="max-w-lg text-muted-foreground">
        This link may have moved. Start with the docs to find setup instructions, workflows, and
        troubleshooting.
      </p>
      <Link href="/docs" className={buttonVariants({ className: "h-11 px-5" })}>
        Open the docs
      </Link>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to Relay
      </Link>
    </main>
  );
}
