/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

export function RouteErrorPage({ reset }: ErrorComponentProps) {
  return (
    <section
      className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 relay-not-found pt-[clamp(72px,14vh,144px)]"
      role="alert"
    >
      <CircleAlert className="mb-4 size-8 text-muted-foreground" aria-hidden="true" />
      <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
        Page unavailable
      </p>
      <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
        This page could not load
      </h1>
      <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
        Try loading it again. If this address is out of date, return Home to find your work.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/home" search={{}} />}>
          Go to Home
        </Button>
      </div>
    </section>
  );
}
