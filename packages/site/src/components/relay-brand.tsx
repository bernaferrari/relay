import Image from "next/image";

export function RelayBrand({ docs = false }: { docs?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image src="/relay-icon.webp" alt="" width={40} height={40} priority />
      <span className="text-xl font-semibold tracking-tight">Relay</span>
      {docs ? (
        <span className="ml-1 border-l border-border pl-3 text-sm font-normal text-muted-foreground">
          Docs
        </span>
      ) : null}
    </span>
  );
}
