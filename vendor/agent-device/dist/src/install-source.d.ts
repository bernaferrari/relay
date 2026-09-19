import { p as LocalInstallSource } from "./sdk-contracts.js";
//#region packages/provision-kit/src/install-source.d.ts
/**
 * @public Archive extensions accepted by install-source resolution.
 */
declare const ARCHIVE_EXTENSIONS: readonly [".zip", ".tar", ".tar.gz", ".tgz"];
declare function validateDownloadSourceUrl(parsedUrl: URL): Promise<void>;
declare function isTrustedInstallSourceUrl(sourceUrl: string | URL): boolean;
//#endregion
export { ARCHIVE_EXTENSIONS, type LocalInstallSource as MaterializeInstallSource, isTrustedInstallSourceUrl, validateDownloadSourceUrl };