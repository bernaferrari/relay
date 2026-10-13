import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

export default withMDX({
  output: "export",
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@relay/ui-react"],
  images: { unoptimized: true },
});
