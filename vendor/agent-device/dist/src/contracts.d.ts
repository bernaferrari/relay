export declare function centerOfRect(rect: Rect): Point;

declare const DAEMON_LOCK_POLICIES: readonly ['reject', 'strip'];

declare type DaemonArtifact = {
    field: string;
    artifactId?: string;
    fileName?: string;
    localPath?: string;
    path?: string;
};

export declare type DaemonError = {
    code: string;
    message: string;
    hint?: string;
    diagnosticId?: string;
    logPath?: string;
    details?: Record<string, unknown>;
    /**
     * Machine-readable typed-error signals (Phase 2). Additive: present only when
     * derivable, so the default error wire shape is unchanged.
     *
     * `retriable` flags a transient failure an agent should retry (vs. a
     * deterministic one where a retry is wasted). `supportedOn` lists the platform
     * families that DO support the command (derived from the capability matrix),
     * surfaced on platform-mismatch errors so an agent self-corrects without a
     * wasted round-trip.
     */
    retriable?: boolean;
    supportedOn?: string;
};

export declare type DaemonInstallSource = {
    kind: 'url';
    url: string;
    headers?: Record<string, string>;
} | {
    kind: 'path';
    path: string;
} | ({
    kind: 'github-actions-artifact';
    owner: string;
    repo: string;
} & ({
    artifactId: number;
} | {
    runId: number;
    artifactName: string;
} | {
    artifactName: string;
}));

declare type DaemonLockPolicy = (typeof DAEMON_LOCK_POLICIES)[number];

export declare type DaemonRequest = {
    token?: string;
    session?: string;
    command: string;
    positionals: string[];
    flags?: Record<string, unknown>;
    runtime?: SessionRuntimeHints;
    meta?: DaemonRequestMeta;
};

declare type DaemonRequestMeta = {
    requestId?: string;
    debug?: boolean;
    includeCost?: boolean;
    responseLevel?: ResponseLevel;
    cwd?: string;
    sessionExplicit?: boolean;
    tenantId?: string;
    runId?: string;
    leaseId?: string;
    leaseTtlMs?: number;
    leaseBackend?: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
    sessionIsolation?: SessionIsolationMode;
    uploadedArtifactId?: string;
    clientArtifactPaths?: Record<string, string>;
    installSource?: DaemonInstallSource;
    retainMaterializedPaths?: boolean;
    materializedPathRetentionMs?: number;
    materializationId?: string;
    lockPolicy?: DaemonLockPolicy;
    lockPlatform?: PlatformSelector;
    requestProgress?: 'replay-test' | 'command';
};

export declare type DaemonResponse = {
    ok: true;
    data?: DaemonResponseData;
} | {
    ok: false;
    error: DaemonError;
};

export declare type DaemonResponseData = Record<string, unknown> & {
    artifacts?: DaemonArtifact[];
    cost?: ResponseCost;
};

export declare function defaultHintForCode(code: string): string | undefined;

export declare type JsonRpcId = string | number | null;

export declare type JsonRpcRequestEnvelope<TParams = unknown> = {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: TParams;
};

declare const LEASE_BACKENDS: readonly ['ios-simulator', 'ios-instance', 'android-instance'];

export declare type LeaseAllocatePayload = {
    token?: string;
    session?: string;
    tenantId?: string;
    tenant?: string;
    runId?: string;
    ttlMs?: number;
    backend?: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
};

export declare type LeaseBackend = (typeof LEASE_BACKENDS)[number];

export declare type LeaseHeartbeatPayload = {
    token?: string;
    session?: string;
    tenantId?: string;
    tenant?: string;
    runId?: string;
    leaseId?: string;
    ttlMs?: number;
    backend?: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
};

export declare type LeaseReleasePayload = {
    token?: string;
    session?: string;
    tenantId?: string;
    tenant?: string;
    runId?: string;
    leaseId?: string;
    backend?: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
};

declare type NormalizedError = {
    code: string;
    message: string;
    hint?: string;
    diagnosticId?: string;
    logPath?: string;
    details?: Record<string, unknown>;
};

export declare function normalizeError(err: unknown, context?: {
    diagnosticId?: string;
    logPath?: string;
}): NormalizedError;

declare const PLATFORM_SELECTORS: readonly ["apple", "android", "linux", "web", "ios", "macos"];

declare type PlatformSelector = (typeof PLATFORM_SELECTORS)[number];

declare type Point = {
    x: number;
    y: number;
};

declare type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

declare const RESPONSE_LEVELS: readonly ['digest', 'default', 'full'];

declare type ResponseCost = {
    wallClockMs: number;
    runnerRoundTrips: number;
    nodeCount?: number;
};

declare type ResponseLevel = (typeof RESPONSE_LEVELS)[number];

declare const SESSION_ISOLATION_MODES: readonly ['none', 'tenant'];

declare type SessionIsolationMode = (typeof SESSION_ISOLATION_MODES)[number];

export declare type SessionRuntimeHints = {
    platform?: 'ios' | 'android';
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    launchUrl?: string;
};

export { }
