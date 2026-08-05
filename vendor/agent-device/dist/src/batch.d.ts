declare type BatchFlags = Record<string, unknown> & {
    batchOnError?: 'stop';
    batchMaxSteps?: number;
    batchSteps?: DaemonBatchStep[];
};

declare type BatchInvoke = (req: BatchRequest) => Promise<DaemonResponse>;

declare type BatchRequest = Omit<DaemonRequest, 'flags'> & {
    flags?: BatchFlags | Record<string, unknown>;
};

declare type BatchRunResponse = {
    ok: true;
    data: BatchRunResult;
} | Extract<DaemonResponse, {
    ok: false;
}>;

declare type BatchRunResult = Record<string, unknown> & {
    total: number;
    executed: number;
    totalDurationMs: number;
    results: BatchStepResult[];
};

declare type BatchStepResult = {
    step: number;
    command: string;
    ok: true;
    data: Record<string, unknown>;
    durationMs: number;
};

declare const DAEMON_LOCK_POLICIES: readonly ['reject', 'strip'];

declare type DaemonArtifact = {
    field: string;
    artifactId?: string;
    fileName?: string;
    localPath?: string;
    path?: string;
};

declare type DaemonBatchStep = {
    command: string;
    positionals?: string[];
    flags?: Record<string, unknown>;
    runtime?: DaemonRequest['runtime'];
};

declare type DaemonError = {
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

declare type DaemonInstallSource = {
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

declare type DaemonRequest = {
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

declare type DaemonResponse = {
    ok: true;
    data?: DaemonResponseData;
} | {
    ok: false;
    error: DaemonError;
};

declare type DaemonResponseData = Record<string, unknown> & {
    artifacts?: DaemonArtifact[];
    cost?: ResponseCost;
};

declare const LEASE_BACKENDS: readonly ['ios-simulator', 'ios-instance', 'android-instance'];

declare type LeaseBackend = (typeof LEASE_BACKENDS)[number];

declare const PLATFORM_SELECTORS: readonly ["apple", "android", "linux", "web", "ios", "macos"];

declare type PlatformSelector = (typeof PLATFORM_SELECTORS)[number];

declare const RESPONSE_LEVELS: readonly ['digest', 'default', 'full'];

declare type ResponseCost = {
    wallClockMs: number;
    runnerRoundTrips: number;
    nodeCount?: number;
};

declare type ResponseLevel = (typeof RESPONSE_LEVELS)[number];

export declare function runBatch(req: BatchRequest, sessionName: string, invoke: BatchInvoke): Promise<BatchRunResponse>;

declare const SESSION_ISOLATION_MODES: readonly ['none', 'tenant'];

declare type SessionIsolationMode = (typeof SESSION_ISOLATION_MODES)[number];

declare type SessionRuntimeHints = {
    platform?: 'ios' | 'android';
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    launchUrl?: string;
};

export { }
