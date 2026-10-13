# Relay website

The public landing page and documentation live together in this package. It uses Next.js,
Fumadocs MDX/Core/UI, Tailwind CSS 4, shared Relay shadcn components, and shadcn's component patterns, cool neutral surfaces, and Relay’s native loop artwork.

## Develop

From the repository root:

```bash
pnpm install
pnpm dev:site
```

Open `http://localhost:3002`. The product app uses its own process and port.

## Build and host

Set `NEXT_PUBLIC_SITE_URL` to the public HTTPS origin in this package's `.env.local`, or in
the build environment. Then:

```bash
pnpm build:site
```

Deploy `packages/site/out/` to a static host. The build prerenders the landing page, all docs,
the search index, sitemap, and robots file. Markdown exports, `llms.txt`, and `llms-full.txt`
are generated from the same MDX content; no search service or API credentials are required.

Use a host that serves exported `.html` routes without the extension (or rewrites `/docs/foo`
to `/docs/foo.html`). No Relay runtime, account data, or device access is part of the site.

## Edit content

Guides are tracked MDX under `content/docs/`. Keep title and description frontmatter fields on
one line, and update the containing `meta.json` when adding or reordering a page. Use absolute
`/docs/...` links. Code blocks use Fumadocs' copy controls and syntax highlighting.

```bash
pnpm --filter @relay/site check:content
pnpm --filter @relay/site typecheck
```

The dev/build command prepares Markdown first. If checking fresh content without either command,
run `node packages/site/scripts/prepare-content.mjs` first.

Keep release claims grounded in the current repository. Relay is currently installed from
source, and upstream e2e support is a reporter/process integration prototype. The landing
page previews and guide screenshots are real captures from an owned local demo; they never
control a browser or device on the documentation site.

## Brand and product imagery

`prepare-brand-assets.mjs` resizes the exact loop artwork from
`packages/desktop/resources/Relay.icon/Assets/relay-loop.png`. It supplies the header,
favicon, and Apple touch icon; do not replace it with a hand-drawn approximation.

The Run, Review, and Map screenshots under `public/images/` were captured from the
production Relay UI on October 13, 2026, using an isolated, owned browser demo workspace.
The demo website was styled for presentation; the Relay interface, outcomes, and review
controls were not altered. The review image shows a pending visual change from an earlier
demo run. These are static product screenshots, not a live browser, and contain no user
accounts, API keys, or shared-report capability URLs.

Keep the three screenshots at the same 1280 × 900 aspect ratio for stable view switching.
They are lossless WebP exports, loaded eagerly for instant view switching. Use the full-size link
to inspect details on smaller screens. Regenerate the social preview after updating them:

```bash
node packages/site/scripts/prepare-brand-assets.mjs
node packages/site/scripts/prepare-social-image.mjs
```
