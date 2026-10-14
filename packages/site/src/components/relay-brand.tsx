import Image from "next/image";

/** One brand lockup for the website and docs, so the mark never shifts between them. */
export function RelayBrand({ docs = false }: { docs?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Image
        src="/relay-icon.webp"
        alt=""
        width={36}
        height={36}
        priority
        className="size-9 drop-shadow-[0_2px_6px_color-mix(in_oklch,var(--ribbon-violet)_28%,transparent)]"
      />
      <span className="font-display text-[1.3rem] leading-8 font-semibold tracking-[-0.03em]">
        Relay
      </span>
      {docs ? (
        <span className="ml-1.5 border-l border-border pl-3 text-sm font-normal text-muted-foreground">
          Docs
        </span>
      ) : null}
    </span>
  );
}
