import Image from "next/image";

/** Real Relay captures shared by the site and user guides. */
export function DocScreenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="my-8">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        aria-label={`View full size: ${alt}`}
        className="block overflow-hidden rounded-xl border bg-card opacity-100!"
      >
        <Image
          src={src}
          alt={alt}
          width={1280}
          height={900}
          sizes="(max-width: 768px) 100vw, 900px"
          className="m-0! block h-auto w-full"
        />
      </a>
      <figcaption className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {caption} <span className="whitespace-nowrap">Select image for full size.</span>
      </figcaption>
    </figure>
  );
}
