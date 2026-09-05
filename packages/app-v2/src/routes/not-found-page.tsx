/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";

export function NotFoundPage() {
  return (
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 relay-not-found pt-[clamp(72px,14vh,144px)]">
      <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
        Not found
      </p>
      <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
        This page is not available
      </h1>
      <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
        Check the address, or return Home to continue in Relay.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link to="/home" search={{}} />}>
        Go to Home
      </Button>
    </section>
  );
}
