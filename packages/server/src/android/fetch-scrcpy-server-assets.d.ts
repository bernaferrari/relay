/** The published fetch-scrcpy-server tarball ships only the downloader bin;
 * the importable entry points are generated into node_modules by Android
 * setup (`pnpm --filter @relay/server android-video:prepare`). Typechecking
 * must not depend on generated node_modules content, and the runtime import
 * in android-live-video-assets.ts validates the asset shape defensively. */
declare module "@yume-chan/fetch-scrcpy-server" {
  export const VERSION: string;
  export const BIN: URL;
}
