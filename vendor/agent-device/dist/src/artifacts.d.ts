//#region src/platforms/android/manifest.d.ts
declare function resolveAndroidArchivePackageName(archivePath: string): Promise<string | undefined>;
//#endregion
export { resolveAndroidArchivePackageName };