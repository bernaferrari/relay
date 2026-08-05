export declare function isTrustedInstallSourceUrl(sourceUrl: string | URL): boolean;

export declare type MaterializeInstallSource = {
    kind: 'url';
    url: string;
    headers?: Record<string, string>;
} | {
    kind: 'path';
    path: string;
};

export declare function validateDownloadSourceUrl(parsedUrl: URL): Promise<void>;

export { }
