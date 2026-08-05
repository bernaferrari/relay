declare type AgentArtifactsResult = CloudArtifactsResult | DaemonArtifactsResult;

declare type AgentDeviceClient = {
    command: AgentDeviceCommandClient;
    devices: {
        list: (options?: AgentDeviceRequestOverrides & AgentDeviceSelectionOptions) => Promise<AgentDeviceDevice[]>;
        boot: (options?: DeviceBootOptions) => Promise<CommandResult<'boot'>>;
        shutdown: (options?: DeviceShutdownOptions) => Promise<CommandResult<'shutdown'>>;
    };
    sessions: {
        list: (options?: AgentDeviceRequestOverrides) => Promise<AgentDeviceSession[]>;
        stateDir: (options?: AgentDeviceRequestOverrides & Pick<AgentDeviceClientConfig, 'stateDir'>) => Promise<string>;
        close: (options?: AgentDeviceRequestOverrides & {
            shutdown?: boolean;
        }) => Promise<SessionCloseResult>;
        artifacts: (options?: CloudArtifactsOptions) => Promise<AgentArtifactsResult>;
    };
    apps: {
        install: (options: AppInstallOptions) => Promise<AppDeployResult>;
        reinstall: (options: AppDeployOptions) => Promise<AppDeployResult>;
        installFromSource: (options: AppInstallFromSourceOptions) => Promise<AppInstallFromSourceResult>;
        list: (options?: AppListOptions) => Promise<string[]>;
        open: (options: AppOpenOptions) => Promise<AppOpenResult>;
        close: (options?: AppCloseOptions) => Promise<AppCloseResult>;
        push: (options: AppPushOptions) => Promise<CommandRequestResult>;
        triggerEvent: (options: AppTriggerEventOptions) => Promise<CommandRequestResult>;
    };
    materializations: {
        release: (options: MaterializationReleaseOptions) => Promise<MaterializationReleaseResult>;
    };
    leases: {
        allocate: (options: LeaseAllocateOptions) => Promise<Lease>;
        heartbeat: (options: LeaseScopedOptions) => Promise<Lease>;
        release: (options: LeaseScopedOptions) => Promise<{
            released: boolean;
            provider?: CloudProviderSessionResult;
        }>;
    };
    metro: {
        prepare: (options: MetroPrepareOptions) => Promise<MetroPrepareResult>;
        reload: (options?: MetroReloadOptions) => Promise<MetroReloadResult>;
    };
    capture: {
        snapshot: (options?: CaptureSnapshotOptions) => Promise<CaptureSnapshotResult>;
        screenshot: (options?: CaptureScreenshotOptions) => Promise<CaptureScreenshotResult>;
        diff: (options: CaptureDiffOptions) => Promise<CommandRequestResult>;
    };
    interactions: {
        click: (options: ClickOptions) => Promise<CommandRequestResult>;
        press: (options: PressOptions) => Promise<CommandRequestResult>;
        longPress: (options: LongPressOptions) => Promise<CommandRequestResult>;
        swipe: (options: SwipeOptions) => Promise<CommandRequestResult>;
        pan: (options: PanOptions) => Promise<CommandRequestResult>;
        fling: (options: FlingOptions) => Promise<CommandRequestResult>;
        swipeGesture: (options: SwipeGestureOptions) => Promise<CommandRequestResult>;
        focus: (options: FocusOptions_2) => Promise<CommandRequestResult>;
        type: (options: TypeTextOptions) => Promise<CommandRequestResult>;
        fill: (options: FillOptions) => Promise<CommandRequestResult>;
        scroll: (options: ScrollOptions_2) => Promise<CommandRequestResult>;
        pinch: (options: PinchOptions) => Promise<CommandRequestResult>;
        rotateGesture: (options: RotateGestureOptions) => Promise<CommandRequestResult>;
        transformGesture: (options: TransformGestureOptions) => Promise<CommandRequestResult>;
        get: (options: GetOptions) => Promise<CommandRequestResult>;
        is: (options: IsOptions) => Promise<CommandRequestResult>;
        find: (options: FindOptions) => Promise<CommandRequestResult>;
    };
    replay: {
        run: (options: ReplayRunOptions) => Promise<CommandRequestResult>;
        test: (options: ReplayTestOptions) => Promise<CommandRequestResult>;
    };
    batch: {
        run: (options: BatchRunOptions) => Promise<BatchRunResult>;
    };
    observability: {
        perf: (options?: PerfOptions) => Promise<CommandRequestResult>;
        logs: (options?: LogsOptions) => Promise<CommandRequestResult>;
        network: (options?: NetworkOptions) => Promise<CommandRequestResult>;
        audio: (options?: AudioOptions) => Promise<CommandRequestResult>;
    };
    debug: {
        symbols: (options: DebugSymbolsOptions) => Promise<DebugSymbolsResult>;
    };
    recording: {
        record: (options: RecordOptions) => Promise<CommandRequestResult>;
        trace: (options: TraceOptions) => Promise<CommandRequestResult>;
    };
    settings: {
        update: (options: SettingsUpdateOptions) => Promise<CommandRequestResult>;
    };
};

declare type AgentDeviceClientConfig = RemoteConnectionProfileFields & CloudProviderProfileFields & {
    session?: string;
    lockPolicy?: DaemonLockPolicy;
    lockPlatform?: PlatformSelector;
    requestId?: string;
    sessionIsolation?: SessionIsolationMode;
    leaseBackend?: LeaseBackend;
    leaseTtlMs?: number;
    runtime?: SessionRuntimeHints;
    cwd?: string;
    debug?: boolean;
    cost?: boolean;
    responseLevel?: ResponseLevel;
    iosXctestrunFile?: string;
    iosXctestDerivedDataPath?: string;
    iosXctestEnvDir?: string;
};

declare type AgentDeviceCommandClient = {
    wait: (options: WaitCommandOptions) => Promise<CommandRequestResult>;
    alert: (options?: AlertCommandOptions) => Promise<CommandRequestResult>;
    appState: (options?: AppStateCommandOptions) => Promise<CommandResult<'appstate'>>;
    back: (options?: BackCommandOptions) => Promise<CommandResult<'back'>>;
    home: (options?: HomeCommandOptions) => Promise<CommandResult<'home'>>;
    rotate: (options: RotateCommandOptions) => Promise<CommandResult<'rotate'>>;
    appSwitcher: (options?: AppSwitcherCommandOptions) => Promise<CommandResult<'app-switcher'>>;
    keyboard: (options?: KeyboardCommandOptions) => Promise<CommandResult<'keyboard'>>;
    clipboard: (options: ClipboardCommandOptions) => Promise<CommandResult<'clipboard'>>;
    reactNative: (options: ReactNativeCommandOptions) => Promise<CommandRequestResult>;
    doctor: (options?: DoctorCommandOptions) => Promise<CommandRequestResult>;
    prepare: (options: PrepareCommandOptions) => Promise<CommandRequestResult>;
    viewport: (options: ViewportCommandOptions) => Promise<CommandResult<'viewport'>>;
};

declare type AgentDeviceDaemonTransport = (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>;

declare type AgentDeviceDevice = {
    platform: PublicPlatform;
    target: DeviceTarget;
    kind: DeviceKind;
    id: string;
    name: string;
    booted?: boolean;
    /**
     * Additive Apple-OS discriminant (iPhone/iPad/tvOS/visionOS/macOS). Present only for
     * Apple devices; `platform` still carries the leaf (`ios`/`macos`).
     */
    appleOs?: AppleOS;
    identifiers: AgentDeviceIdentifiers;
    ios?: {
        udid: string;
    };
    android?: {
        serial: string;
    };
};

declare type AgentDeviceIdentifiers = {
    session?: string;
    deviceId?: string;
    deviceName?: string;
    udid?: string;
    serial?: string;
    appId?: string;
    appBundleId?: string;
    package?: string;
};

declare type AgentDeviceRequestOverrides = Pick<AgentDeviceClientConfig, 'session' | 'lockPolicy' | 'lockPlatform' | 'requestId' | 'daemonBaseUrl' | 'daemonAuthToken' | 'daemonTransport' | 'daemonServerMode' | 'tenant' | 'sessionIsolation' | 'runId' | 'leaseId' | 'leaseBackend' | 'leaseProvider' | 'deviceKey' | 'clientId' | 'providerApp' | 'providerOsVersion' | 'providerProject' | 'providerBuild' | 'providerSessionName' | 'awsProjectArn' | 'awsDeviceArn' | 'awsAppArn' | 'awsRegion' | 'awsInteractionMode' | 'leaseTtlMs' | 'cwd' | 'debug' | 'cost' | 'responseLevel' | 'iosXctestrunFile' | 'iosXctestDerivedDataPath' | 'iosXctestEnvDir'>;

declare type AgentDeviceSelectionOptions = {
    platform?: PlatformSelector;
    target?: DeviceTarget;
    device?: string;
    udid?: string;
    serial?: string;
    iosSimulatorDeviceSet?: string;
    androidDeviceAllowlist?: string;
};

declare type AgentDeviceSession = {
    name: string;
    createdAt: number;
    sessionStateDir?: string;
    runnerLogPath?: string;
    device: AgentDeviceSessionDevice;
    identifiers: AgentDeviceIdentifiers;
};

declare type AgentDeviceSessionDevice = {
    platform: PublicPlatform;
    target: DeviceTarget;
    id: string;
    name: string;
    /**
     * Additive Apple-OS discriminant (iPhone/iPad/tvOS/visionOS/macOS). Present only for
     * Apple devices; `platform` still carries the leaf (`ios`/`macos`).
     */
    appleOs?: AppleOS;
    identifiers: AgentDeviceIdentifiers;
    ios?: {
        udid: string;
        simulatorSetPath?: string | null;
    };
    android?: {
        serial: string;
    };
};

declare const ALERT_ACTIONS: readonly ['get', 'accept', 'dismiss', 'wait'];

declare type AlertAction = (typeof ALERT_ACTIONS)[number];

declare type AlertCommandOptions = DeviceCommandBaseOptions & {
    action?: AlertAction;
    timeoutMs?: number;
};

declare type AndroidSnapshotBackendMetadata = {
    backend: 'android-helper' | 'uiautomator-dump';
    helperVersion?: string;
    helperApiVersion?: string;
    helperTransport?: AndroidSnapshotHelperTransport;
    helperSessionReused?: boolean;
    fallbackReason?: string;
    installReason?: AndroidSnapshotHelperInstallReason;
    waitForIdleTimeoutMs?: number;
    waitForIdleQuietMs?: number;
    timeoutMs?: number;
    maxDepth?: number;
    maxNodes?: number;
    rootPresent?: boolean;
    captureMode?: AndroidSnapshotCaptureMode;
    windowCount?: number;
    nodeCount?: number;
    helperTruncated?: boolean;
    elapsedMs?: number;
};

declare type AndroidSnapshotCaptureMode = 'interactive-windows' | 'active-window';

declare type AndroidSnapshotHelperInstallReason = 'missing' | 'outdated' | 'forced' | 'current' | 'skipped';

declare type AndroidSnapshotHelperTransport = 'instrumentation' | 'persistent-session';

declare type AppCloseOptions = AgentDeviceRequestOverrides & {
    app?: string;
    shutdown?: boolean;
};

declare type AppCloseResult = {
    session: string;
    closedApp?: string;
    shutdown?: TargetShutdownResult;
    identifiers: AgentDeviceIdentifiers;
};

declare type AppDeployOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    app: string;
    appPath: string;
};

declare type AppDeployResult = {
    app: string;
    appPath: string;
    platform: PublicPlatform;
    appId?: string;
    bundleId?: string;
    package?: string;
    identifiers: AgentDeviceIdentifiers;
};

export declare class AppError extends Error {
    code: AppErrorCode;
    details?: AppErrorDetails;
    cause?: unknown;
    constructor(code: AppErrorCode, message: string, details?: AppErrorDetails, cause?: unknown);
}

declare type AppErrorCode = KnownAppErrorCode | (string & {});

declare type AppErrorDetails = Record<string, unknown> & {
    hint?: string;
    diagnosticId?: string;
    logPath?: string;
};

declare type AppInstallFromSourceOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    source: DaemonInstallSource;
    retainPaths?: boolean;
    retentionMs?: number;
};

declare type AppInstallFromSourceResult = {
    appName?: string;
    appId?: string;
    bundleId?: string;
    packageName?: string;
    launchTarget: string;
    installablePath?: string;
    archivePath?: string;
    materializationId?: string;
    materializationExpiresAt?: string;
    identifiers: AgentDeviceIdentifiers;
};

declare type AppInstallOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    app?: string;
    appPath: string;
};

declare const APPLE_OS_VALUES: readonly ['ios', 'ipados', 'tvos', 'watchos', 'visionos', 'macos'];

declare type AppleOS = (typeof APPLE_OS_VALUES)[number];

declare type AppListOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    appsFilter?: AppsFilter;
};

declare type AppOpenOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    app?: string;
    url?: string;
    surface?: SessionSurface;
    activity?: string;
    launchConsole?: string;
    launchArgs?: string[];
    relaunch?: boolean;
    saveScript?: boolean | string;
    deviceHub?: boolean;
    noRecord?: boolean;
    runtime?: SessionRuntimeHints;
};

declare type AppOpenResult = {
    session: string;
    sessionStateDir?: string;
    runnerLogPath?: string;
    requestLogPath?: string;
    appName?: string;
    appBundleId?: string;
    appId?: string;
    startup?: StartupPerfSample;
    runtime?: SessionRuntimeHints;
    device?: AgentDeviceSessionDevice;
    identifiers: AgentDeviceIdentifiers;
};

declare type AppPushOptions = DeviceCommandBaseOptions & {
    app: string;
    payload: string | Record<string, unknown>;
};

declare type AppsFilter = 'user-installed' | 'all';

declare type AppStateCommandOptions = DeviceCommandBaseOptions;

/**
 * Closed result of the `appstate` command, grounded in the daemon handler's
 * success returns (src/daemon/handlers/session-state.ts `handleAppStateCommand`).
 * A discriminated union on `platform`:
 *  - Apple (`ios` / `macos`) session state, with iOS-only device locators that
 *    the previous hand-written mirror omitted; and
 *  - Android foreground `package` / `activity`.
 *
 * The handler returns one of these fixed objects (errors take the `ok: false`
 * path), so each branch is closed.
 */
declare type AppStateCommandResult = {
    platform: 'ios' | 'macos';
    appName: string;
    appBundleId?: string;
    source: 'session';
    surface: SessionSurface;
    /** iOS only — the session device's UDID. */
    device_udid?: string;
    /** iOS only — the simulator set path, or `null` when unknown. */
    ios_simulator_device_set?: string | null;
} | {
    platform: 'android';
    package: string;
    activity: string;
};

declare type AppSwitcherCommandOptions = DeviceCommandBaseOptions;

/** `app-switcher` — `{ action: 'app-switcher', message: 'Opened app switcher' }`. */
declare type AppSwitcherCommandResult = {
    action: 'app-switcher';
    message: string;
};

declare type AppTriggerEventOptions = DeviceCommandBaseOptions & {
    event: string;
    payload?: Record<string, unknown>;
};

declare type ArtifactAdapter = {
    resolveInput(ref: FileInputRef, options: ResolveInputOptions): Promise<ResolvedInputFile>;
    reserveOutput(ref: FileOutputRef | undefined, options: ReserveOutputOptions): Promise<ReservedOutputFile>;
    createTempFile(options: CreateTempFileOptions): Promise<TemporaryFile>;
};

declare type ArtifactDescriptor = {
    kind: 'localPath';
    field: string;
    path: string;
    fileName?: string;
    metadata?: Record<string, unknown>;
} | {
    kind: 'artifact';
    field: string;
    artifactId: string;
    fileName?: string;
    url?: string;
    clientPath?: string;
    metadata?: Record<string, unknown>;
};

declare type AudioOptions = AgentDeviceRequestOverrides & {
    action?: 'probe';
    probeAction?: 'start' | 'status' | 'stop';
    durationMs?: number;
    bucketMs?: number;
};

declare const BACK_MODES: readonly ['in-app', 'system'];

declare type BackCommandOptions = DeviceCommandBaseOptions & {
    mode?: BackMode;
};

/** `back` — `{ action: 'back', mode, message: 'Back' }`; `mode` defaults to `'in-app'`. */
declare type BackCommandResult = {
    action: 'back';
    mode: BackMode;
    message: string;
};

declare type BackMode = (typeof BACK_MODES)[number];

declare type BatchRunOptions = AgentDeviceRequestOverrides & {
    steps: BatchStep[];
    onError?: 'stop';
    maxSteps?: number;
    out?: string;
};

declare type BatchRunResult = Record<string, unknown> & {
    total: number;
    executed: number;
    totalDurationMs: number;
    results: BatchStepResult[];
};

declare type BatchStep = {
    command: string;
    input: Record<string, unknown>;
    runtime?: SessionRuntimeHints;
};

declare type BatchStepResult = {
    step: number;
    command: string;
    ok: true;
    data: Record<string, unknown>;
    durationMs: number;
};

/**
 * Closed result of the `boot` command. Mirrors the daemon handler's only
 * success return EXACTLY (src/daemon/handlers/session-state.ts) — the fixed
 * object literal `{ platform, target, device, id, kind, booted }` plus the
 * additive `appleOs` discriminant, emitted only for Apple devices.
 */
declare type BootCommandResult = {
    platform: PublicPlatform;
    target: DeviceTarget;
    /** Human-readable device name (`device.name`). */
    device: string;
    /** Stable device id (`device.id`). */
    id: string;
    kind: DeviceKind;
    /** Always `true` on the success path. */
    booted: true;
    /**
     * Additive Apple-OS discriminant (`device.appleOs`): iPhone/iPad/tvOS/visionOS/macOS.
     * Present only for Apple devices; absent for non-Apple platforms. `platform` stays the
     * leaf (`ios`/`macos`) — this is an extra field, not a replacement.
     */
    appleOs?: AppleOS;
};

declare type CaptureDiffOptions = DeviceCommandBaseOptions & Pick<CaptureSnapshotOptions, 'interactiveOnly' | 'depth' | 'scope' | 'raw'> & {
    kind: 'snapshot';
    out?: string;
};

declare type CaptureScreenshotOptions = AgentDeviceRequestOverrides & {
    path?: string;
    overlayRefs?: boolean;
    fullscreen?: boolean;
    maxSize?: number;
    stabilize?: boolean;
    normalizeStatusBar?: boolean;
    surface?: SessionSurface;
};

declare type CaptureScreenshotResult = ScreenshotResultData & {
    path: string;
    identifiers: AgentDeviceIdentifiers;
};

declare type CaptureSnapshotOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    interactiveOnly?: boolean;
    depth?: number;
    scope?: string;
    raw?: boolean;
    forceFull?: boolean;
    timeoutMs?: number;
};

declare type CaptureSnapshotResult = {
    nodes: SnapshotNode[];
    truncated: boolean;
    appName?: string;
    appBundleId?: string;
    visibility?: SnapshotVisibility;
    unchanged?: SnapshotUnchanged;
    snapshotDiagnostics?: SnapshotDiagnosticsSummary;
    identifiers: AgentDeviceIdentifiers;
} & PublicSnapshotCaptureAnnotations;

export declare function centerOfRect(rect: Rect): Point;

declare const CLICK_BUTTONS: readonly ['primary', 'secondary', 'middle'];

declare type ClickButton = (typeof CLICK_BUTTONS)[number];

declare type ClickOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & RepeatedPressOptions & {
    button?: ClickButton;
};

declare type ClipboardCommandOptions = (DeviceCommandBaseOptions & {
    action: 'read';
}) | (DeviceCommandBaseOptions & {
    action: 'write';
    text: string;
}) | (DeviceCommandBaseOptions & {
    action: 'paste';
    text: string;
    selectorKey: 'id' | 'label' | 'text' | 'value';
    selectorValue: string;
}) | (DeviceCommandBaseOptions & {
    action: 'copy';
    selectorKey: 'id' | 'label' | 'text' | 'value';
    selectorValue: string;
    expectedText?: string;
});

/**
 * Closed result of the `clipboard` command. Mirrors the dispatch handler's
 * literal return EXACTLY (src/core/dispatch.ts `handleClipboardCommand`): a
 * discriminated union on `action`. `read` returns the clipboard `text`; `write`
 * reports the written `textLength` plus the `successText` message. The handler
 * spreads nothing else, so each branch is closed.
 */
declare type ClipboardCommandResult = {
    action: 'read';
    text: string;
} | {
    action: 'write';
    textLength: number;
    message: string;
} | {
    action: 'paste' | 'copy';
    text: string;
    textLength: number;
    message: string;
};

declare const CLOUD_ARTIFACT_KINDS: readonly ['video', 'appium-log', 'device-log', 'automation-log', 'provider-session', 'raw'];

declare type CloudArtifact = {
    provider: string;
    kind: CloudArtifactKind;
    name: string;
    url?: string;
    providerSessionId?: string;
    providerArtifactId?: string;
    contentType?: string;
    extension?: string;
    availability?: CloudArtifactAvailability;
    metadata?: Record<string, unknown>;
};

declare type CloudArtifactAvailability = 'ready' | 'pending' | 'unavailable' | 'expired';

declare type CloudArtifactKind = (typeof CLOUD_ARTIFACT_KINDS)[number];

declare type CloudArtifactsOptions = AgentDeviceRequestOverrides & {
    provider?: string;
    providerSessionId?: string;
};

declare type CloudArtifactsResult = {
    provider: string;
    status: CloudArtifactsStatus;
    cloudArtifacts: CloudArtifact[];
    providerSessionId?: string;
    message?: string;
};

declare type CloudArtifactsStatus = 'ready' | 'pending' | 'unavailable';

declare type CloudProviderProfileFields = {
    providerApp?: string;
    providerOsVersion?: string;
    providerProject?: string;
    providerBuild?: string;
    providerSessionName?: string;
    awsProjectArn?: string;
    awsDeviceArn?: string;
    awsAppArn?: string;
    awsRegion?: string;
    awsInteractionMode?: 'INTERACTIVE' | 'NO_VIDEO' | 'VIDEO_ONLY';
};

declare type CloudProviderSessionResult = {
    provider?: string;
    providerSessionId?: string;
    cloudArtifacts?: CloudArtifactsResult;
} & Record<string, unknown>;

declare type CommandRequestResult = DaemonResponseData;

/**
 * The typed result for a command named `N`. Seeded commands resolve to their
 * contract result type from {@link CommandResultMap}; every other (unmigrated)
 * command falls back to the untyped `Record<string, unknown>` bag. That default
 * branch is what keeps the mapping total over every command name, so consumers
 * can switch to `CommandResult<Name>` without first migrating every command.
 */
declare type CommandResult<N extends string> = N extends keyof CommandResultMap ? CommandResultMap[N] : Record<string, unknown>;

/**
 * The additive typed-result spine (ADR-0008, Phase 1 step 6).
 *
 * Maps a command name to the per-command result type from `src/contracts/*`. It
 * is SEEDED, not exhaustive: a command is listed here only once its accurate,
 * closed result shape lives in the contracts layer. Commands whose daemon
 * handler spreads dynamic/Record data (screenshot overlays, gesture
 * visualization, perf, logs, …) are deliberately omitted rather than given an
 * invented shape.
 *
 * Batches 1-2 wired `boot` / `shutdown` / `viewport` and the navigation/action
 * commands `home` / `back` / `rotate` / `app-switcher` alongside the seed
 * interaction trio. Batch 3 adds `clipboard` (a closed `read`/`write` union) and
 * `appstate` (a closed `platform` union — Apple session state with the iOS-only
 * device locators, or Android package/activity). Batch 4 adds `keyboard` (a
 * closed flat shape). Each entry is grounded in a
 * re-read of the handler's literal return; see the per-type docstrings.
 */
declare interface CommandResultMap {
    press: PressCommandResult;
    fill: FillCommandResult;
    longpress: LongPressCommandResult;
    boot: BootCommandResult;
    shutdown: ShutdownCommandResult;
    viewport: ViewportCommandResult;
    home: HomeCommandResult;
    back: BackCommandResult;
    rotate: RotateCommandResult;
    'app-switcher': AppSwitcherCommandResult;
    clipboard: ClipboardCommandResult;
    appstate: AppStateCommandResult;
    keyboard: KeyboardCommandResult;
}

declare type CompanionTunnelScope = {
    tenantId: string;
    runId: string;
    leaseId: string;
};

export declare function createAgentDeviceClient(config?: AgentDeviceClientConfig, deps?: {
    transport?: AgentDeviceDaemonTransport;
}): AgentDeviceClient;

export declare function createLocalArtifactAdapter(options?: LocalArtifactAdapterOptions): ArtifactAdapter;

declare type CreateTempFileOptions = {
    prefix: string;
    ext: string;
};

declare const DAEMON_LOCK_POLICIES: readonly ['reject', 'strip'];

declare const DAEMON_SERVER_MODES: readonly ['socket', 'http', 'dual'];

declare const DAEMON_TRANSPORT_PREFERENCES: readonly ['auto', 'socket', 'http'];

declare type DaemonArtifact = {
    field: string;
    artifactId?: string;
    fileName?: string;
    localPath?: string;
    path?: string;
};

declare type DaemonArtifactInventoryEntry = {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    expiresAt: string;
};

declare type DaemonArtifactsResult = {
    source: 'daemon';
    status: 'ready';
    artifacts: DaemonArtifactInventoryEntry[];
    message?: string;
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

declare type DaemonServerMode = (typeof DAEMON_SERVER_MODES)[number];

declare type DaemonTransportPreference = (typeof DAEMON_TRANSPORT_PREFERENCES)[number];

declare type DebugSymbolsCrashFrame = {
    index: number;
    image: string;
    address: string;
    symbol?: string;
};

declare type DebugSymbolsCrashSummary = {
    format: 'ips' | 'text';
    appName?: string;
    bundleId?: string;
    version?: string;
    incident?: string;
    timestamp?: string;
    exceptionType?: string;
    exceptionCodes?: string;
    terminationReason?: string;
    crashedThread?: number;
    topFrames: DebugSymbolsCrashFrame[];
    findings: string[];
};

declare type DebugSymbolsImage = {
    name: string;
    uuid: string;
    arch?: string;
    dsymPath: string;
    binaryPath: string;
};

declare type DebugSymbolsOptions = {
    action?: 'symbols';
    artifact: string;
    dsym?: string;
    searchPath?: string;
    out?: string;
    cwd?: string;
};

declare type DebugSymbolsResult = {
    kind: 'debugSymbols';
    platform: 'apple';
    artifactPath: string;
    outPath: string;
    crash: DebugSymbolsCrashSummary;
    matchedImages: DebugSymbolsImage[];
    symbolicatedFrames: number;
    skippedImages: number;
    warnings?: string[];
    message: string;
};

declare const DEVICE_KINDS: readonly ['simulator', 'emulator', 'device'];

declare const DEVICE_ROTATIONS: readonly ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'];

declare const DEVICE_TARGETS: readonly ['mobile', 'tv', 'desktop'];

declare type DeviceBootOptions = DeviceCommandBaseOptions & {
    headless?: boolean;
};

declare type DeviceCommandBaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions;

declare type DeviceKind = (typeof DEVICE_KINDS)[number];

declare type DeviceRotation = (typeof DEVICE_ROTATIONS)[number];

declare type DeviceShutdownOptions = DeviceCommandBaseOptions;

declare type DeviceTarget = (typeof DEVICE_TARGETS)[number];

declare type DoctorCommandOptions = DeviceCommandBaseOptions & {
    targetApp?: string;
    remote?: boolean;
};

declare type ElementTarget = RefTarget | SelectorTarget;

declare type FileInputRef = {
    kind: 'path';
    path: string;
} | {
    kind: 'uploadedArtifact';
    id: string;
};

declare type FileOutputRef = {
    kind: 'path';
    path: string;
} | {
    kind: 'downloadableArtifact';
    clientPath?: string;
    fileName?: string;
};

declare type FillCommandResult = ResolvedInteractionTarget & {
    text: string;
    warning?: string;
    backendResult?: Record<string, unknown>;
    message?: string;
};

declare type FillOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & {
    text: string;
    delayMs?: number;
};

declare const FIND_LOCATORS: readonly ['any', 'text', 'label', 'value', 'role', 'id'];

declare type FindBaseOptions = DeviceCommandBaseOptions & FindSnapshotCommandOptions & {
    locator?: FindLocator;
    query: string;
    first?: boolean;
    last?: boolean;
};

declare type FindLocator = (typeof FIND_LOCATORS)[number];

declare type FindOptions = (FindBaseOptions & {
    action?: 'click' | 'focus' | 'exists' | 'getText' | 'getAttrs';
}) | (FindBaseOptions & {
    action: 'wait';
    timeoutMs?: number;
}) | (FindBaseOptions & {
    action: 'fill' | 'type';
    value: string;
});

declare type FindSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'raw'>;

declare type FlingOptions = DeviceCommandBaseOptions & {
    direction: ScrollDirection;
    x: number;
    y: number;
    distance?: number;
    durationMs?: number;
};

declare type FocusOptions_2 = DeviceCommandBaseOptions & {
    x: number;
    y: number;
};

declare type GetOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & ElementTarget & {
    format: 'text' | 'attrs';
};

declare type HomeCommandOptions = DeviceCommandBaseOptions;

/**
 * Closed results of the navigation/global action commands. Each mirrors the
 * dispatch handler's literal return EXACTLY (src/core/dispatch.ts
 * `DISPATCH_HANDLERS`): a fixed `action` discriminant plus the always-present
 * `successText` message (the handlers always pass a non-empty message, so it is
 * required here). The handlers spread nothing else, so the shapes are closed —
 * consistent with the `viewport` contract, the generic-dispatch Android
 * dialog-recovery `warning` annotation is intentionally not part of the contract.
 */
/** `home` — `{ action: 'home', message: 'Home' }`. */
declare type HomeCommandResult = {
    action: 'home';
    message: string;
};

declare type InteractionTarget = PointTarget | RefTarget | SelectorTarget;

export declare function isAgentDeviceError(err: unknown): err is AppError;

declare type IsOptions = IsTextPredicateOptions | IsStatePredicateOptions;

declare type IsStatePredicateOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & {
    predicate: 'visible' | 'hidden' | 'exists' | 'editable' | 'selected';
    selector: string;
    value?: never;
};

declare type IsTextPredicateOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & {
    predicate: 'text';
    selector: string;
    value: string;
};

declare type KeyboardCommandOptions = DeviceCommandBaseOptions & {
    action?: 'status' | 'dismiss' | 'enter' | 'return';
};

/**
 * Closed result of the `keyboard` command, grounded in the dispatch handlers'
 * literal returns (src/core/dispatch.ts `handleAndroidKeyboardCommand` /
 * `handleIosKeyboardCommand`).
 *
 * `platform` and `action` are always present; the remaining fields appear per
 * branch (Android `status`/`dismiss` carry the keyboard-state fields; `enter`
 * and iOS `dismiss` carry a `message`). It is kept as a flat closed shape rather
 * than a five-way `platform`×`action` union because the per-branch field sets
 * overlap heavily and the underlying Android keyboard-state types live in the
 * platform layer (below the public contract). The `Record` index signature of
 * the previous hand-written mirror is dropped, and the spurious `| null`s are
 * removed (the handler never returns `null` for these).
 */
declare type KeyboardCommandResult = {
    platform: 'android' | 'ios';
    action: 'status' | 'dismiss' | 'enter';
    visible?: boolean;
    wasVisible?: boolean;
    dismissed?: boolean;
    attempts?: number;
    inputType?: string;
    type?: 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';
    inputMethodPackage?: string;
    focusedPackage?: string;
    focusedResourceId?: string;
    inputOwner?: 'app' | 'ime' | 'unknown';
    message?: string;
};

declare type KnownAppErrorCode = 'INVALID_ARGS' | 'DEVICE_NOT_FOUND' | 'DEVICE_IN_USE' | 'TOOL_MISSING' | 'APP_NOT_INSTALLED' | 'UNSUPPORTED_PLATFORM' | 'UNSUPPORTED_OPERATION' | 'NOT_IMPLEMENTED' | 'COMMAND_FAILED' | 'SESSION_NOT_FOUND' | 'UNAUTHORIZED' | 'AMBIGUOUS_MATCH' | 'UNKNOWN';

declare type Lease = {
    leaseId: string;
    tenantId: string;
    runId: string;
    backend: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
    createdAt?: number;
    heartbeatAt?: number;
    expiresAt?: number;
};

declare const LEASE_BACKENDS: readonly ['ios-simulator', 'ios-instance', 'android-instance'];

declare type LeaseAllocateOptions = LeaseOptions & {
    tenant: string;
    runId: string;
    leaseBackend?: LeaseBackend;
    leaseProvider?: string;
    provider?: string;
    deviceKey?: string;
    clientId?: string;
};

declare type LeaseBackend = (typeof LEASE_BACKENDS)[number];

declare type LeaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    ttlMs?: number;
};

declare type LeaseScopedOptions = LeaseOptions & {
    tenant?: string;
    runId?: string;
    leaseId: string;
    leaseBackend?: LeaseBackend;
    leaseProvider?: string;
    provider?: string;
    deviceKey?: string;
    clientId?: string;
};

declare type LocalArtifactAdapterOptions = {
    cwd?: string;
    tempDir?: string;
    rootDir?: string;
};

declare const LOG_ACTION_VALUES: readonly ['path', 'start', 'stop', 'doctor', 'mark', 'clear'];

declare type LogAction = (typeof LOG_ACTION_VALUES)[number];

declare type LogsOptions = AgentDeviceRequestOverrides & {
    action?: LogAction;
    message?: string;
    restart?: boolean;
};

declare type LongPressCommandResult = ResolvedInteractionTarget & {
    durationMs?: number;
    backendResult?: Record<string, unknown>;
    message?: string;
};

declare type LongPressOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & {
    durationMs?: number;
};

declare type MaterializationReleaseOptions = AgentDeviceRequestOverrides & {
    materializationId: string;
};

declare type MaterializationReleaseResult = {
    released: boolean;
    materializationId: string;
    identifiers: AgentDeviceIdentifiers;
};

declare type MetroBridgeResult = {
    enabled: boolean;
    baseUrl: string;
    statusUrl: string;
    bundleUrl: string;
    iosRuntime: MetroRuntimeHints;
    androidRuntime: MetroRuntimeHints;
    upstream: {
        bundleUrl: string;
        host: string;
        port: number;
        statusUrl: string;
    };
    probe: {
        reachable: boolean;
        statusCode: number;
        latencyMs: number;
        detail: string;
    };
};

declare type MetroBridgeScope = CompanionTunnelScope;

declare type MetroPrepareKind = 'auto' | 'react-native' | 'expo';

declare type MetroPrepareOptions = {
    projectRoot?: string;
    kind?: MetroPrepareKind;
    publicBaseUrl?: string;
    proxyBaseUrl?: string;
    bearerToken?: string;
    bridgeScope?: MetroBridgeScope;
    launchUrl?: string;
    companionProfileKey?: string;
    companionConsumerKey?: string;
    port?: number;
    listenHost?: string;
    statusHost?: string;
    startupTimeoutMs?: number;
    probeTimeoutMs?: number;
    reuseExisting?: boolean;
    installDependenciesIfNeeded?: boolean;
    runtimeFilePath?: string;
    logPath?: string;
};

declare type MetroPrepareResult = PrepareMetroRuntimeResult;

declare type MetroReloadOptions = {
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    timeoutMs?: number;
};

declare type MetroReloadResult = ReloadMetroResult;

/** Re-export of {@link SessionRuntimeHints} under the Metro-specific alias used by public API consumers. */
declare type MetroRuntimeHints = SessionRuntimeHints;

declare const NETWORK_INCLUDE_MODES: readonly ['summary', 'headers', 'body', 'all'];

declare type NetworkIncludeMode = (typeof NETWORK_INCLUDE_MODES)[number];

declare type NetworkOptions = AgentDeviceRequestOverrides & {
    action?: 'dump' | 'log';
    limit?: number;
    include?: NetworkIncludeMode;
};

export declare function normalizeAgentDeviceError(err: unknown, context?: {
    diagnosticId?: string;
    logPath?: string;
}): NormalizedError;

declare type NormalizedError = {
    code: string;
    message: string;
    hint?: string;
    diagnosticId?: string;
    logPath?: string;
    details?: Record<string, unknown>;
};

declare type OutputVisibility = 'client-visible' | 'internal';

declare type PanOptions = DeviceCommandBaseOptions & {
    x: number;
    y: number;
    dx: number;
    dy: number;
    durationMs?: number;
};

declare const PERF_ACTION_VALUES: readonly ['sample', 'snapshot', 'start', 'stop', 'report'];

declare const PERF_AREA_VALUES: readonly ['metrics', 'frames', 'memory', 'cpu', 'trace'];

declare const PERF_KIND_VALUES: readonly ['xctrace', 'simpleperf', 'perfetto', 'android-hprof', 'memgraph'];

declare const PERF_SUBJECT_VALUES: readonly ['profile'];

declare type PerfAction = (typeof PERF_ACTION_VALUES)[number];

declare type PerfArea = (typeof PERF_AREA_VALUES)[number];

declare type PerfKind = (typeof PERF_KIND_VALUES)[number];

declare type PerfOptions = DeviceCommandBaseOptions & {
    area?: PerfArea;
    subject?: PerfSubject;
    action?: PerfAction;
    kind?: PerfKind;
    template?: string;
    out?: string;
    tracePath?: string;
};

declare type PerfSubject = (typeof PERF_SUBJECT_VALUES)[number];

declare type PermissionTarget = 'camera' | 'microphone' | 'photos' | 'contacts' | 'contacts-limited' | 'notifications' | 'calendar' | 'location' | 'location-always' | 'media-library' | 'motion' | 'reminders' | 'siri' | 'accessibility' | 'screen-recording' | 'input-monitoring';

declare type PinchOptions = DeviceCommandBaseOptions & {
    scale: number;
    x?: number;
    y?: number;
};

declare const PLATFORM_SELECTORS: readonly ["apple", "android", "linux", "web", "ios", "macos"];

declare type PlatformSelector = (typeof PLATFORM_SELECTORS)[number];

declare type Point = {
    x: number;
    y: number;
};

declare type PointTarget = {
    x: number;
    y: number;
    ref?: never;
    selector?: never;
    label?: never;
};

declare type PrepareCommandOptions = DeviceCommandBaseOptions & {
    action: 'ios-runner';
    timeoutMs?: number;
};

declare type PrepareMetroRuntimeResult = {
    projectRoot: string;
    kind: ResolvedMetroKind;
    dependenciesInstalled: boolean;
    packageManager: string | null;
    started: boolean;
    reused: boolean;
    pid: number;
    logPath: string;
    statusUrl: string;
    runtimeFilePath: string | null;
    iosRuntime: MetroRuntimeHints;
    androidRuntime: MetroRuntimeHints;
    bridge: MetroBridgeResult | null;
};

declare type PressCommandResult = ResolvedInteractionTarget & {
    backendResult?: Record<string, unknown>;
    message?: string;
};

declare type PressOptions = DeviceCommandBaseOptions & SelectorSnapshotCommandOptions & InteractionTarget & RepeatedPressOptions;

declare const PUBLIC_PLATFORMS: readonly ['ios', 'macos', 'android', 'linux', 'web'];

declare type PublicPlatform = (typeof PUBLIC_PLATFORMS)[number];

declare type PublicSnapshotCaptureAnnotations = Pick<SnapshotCaptureAnnotations, 'androidSnapshot' | 'warnings'> & {
    snapshotQuality?: SnapshotQualityVerdict;
};

declare type RawSnapshotNode = {
    index: number;
    type?: string;
    role?: string;
    subrole?: string;
    label?: string;
    value?: string;
    identifier?: string;
    rect?: Rect;
    enabled?: boolean;
    selected?: boolean;
    focused?: boolean;
    visibleToUser?: boolean;
    hittable?: boolean;
    depth?: number;
    parentIndex?: number;
    pid?: number;
    bundleId?: string;
    appName?: string;
    windowTitle?: string;
    surface?: string;
    hiddenContentAbove?: boolean;
    hiddenContentBelow?: boolean;
    interactionBlocked?: 'covered';
    presentationHints?: string[];
};

declare type ReactNativeCommandOptions = DeviceCommandBaseOptions & {
    action: 'dismiss-overlay';
};

declare const RECORDING_EXPORT_QUALITIES: readonly ['medium', 'high'];

declare type RecordingExportQuality = (typeof RECORDING_EXPORT_QUALITIES)[number];

declare type RecordOptions = AgentDeviceRequestOverrides & {
    action: 'start' | 'stop';
    path?: string;
    fps?: number;
    maxSize?: number;
    quality?: RecordingExportQuality;
    hideTouches?: boolean;
};

declare type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

declare type RefTarget = {
    ref: string;
    label?: string;
    x?: never;
    y?: never;
    selector?: never;
};

declare type ReloadMetroResult = {
    reloaded: true;
    reloadUrl: string;
    status: number;
    body: string;
};

declare type RemoteConnectionProfileFields = {
    stateDir?: string;
    daemonBaseUrl?: string;
    daemonAuthToken?: string;
    daemonTransport?: DaemonTransportPreference;
    daemonServerMode?: DaemonServerMode;
    tenant?: string;
    sessionIsolation?: SessionIsolationMode;
    runId?: string;
    leaseId?: string;
    leaseBackend?: LeaseBackend;
    leaseProvider?: string;
    deviceKey?: string;
    clientId?: string;
};

declare type RepeatedPressOptions = {
    count?: number;
    intervalMs?: number;
    holdMs?: number;
    jitterPx?: number;
    doubleTap?: boolean;
};

declare type ReplayRunOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    path: string;
    update?: boolean;
    /** @deprecated Use backend: 'maestro'. */
    maestro?: boolean;
    backend?: string;
    env?: string[];
    timeoutMs?: number;
};

declare type ReplayTestOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions & {
    paths: string[];
    update?: boolean;
    /** @deprecated Use backend: 'maestro'. */
    maestro?: boolean;
    backend?: string;
    env?: string[];
    failFast?: boolean;
    timeoutMs?: number;
    retries?: number;
    recordVideo?: boolean;
    artifactsDir?: string;
    /** @deprecated Use the CLI --reporter junit:<path> or --report-junit <path>. */
    reportJunit?: string;
    shardAll?: number;
    shardSplit?: number;
};

declare type ReservedOutputFile = {
    path: string;
    visibility: OutputVisibility;
    publish: () => Promise<ArtifactDescriptor | undefined>;
    cleanup?: () => Promise<void>;
};

declare type ReserveOutputOptions = {
    field: string;
    ext: string;
    requestedClientPath?: string;
    visibility?: OutputVisibility;
};

declare type ResolvedInputFile = {
    path: string;
    cleanup?: () => Promise<void>;
};

declare type ResolvedInteractionTarget = {
    kind: 'point';
    point: Point;
} | {
    kind: 'ref';
    point?: Point;
    target: Extract<ResolvedTarget, {
        kind: 'ref';
    }>;
    node?: SnapshotNode;
    selectorChain?: string[];
    refLabel?: string;
} | {
    kind: 'selector';
    point: Point;
    target: Extract<ResolvedTarget, {
        kind: 'selector';
    }>;
    node: SnapshotNode;
    selectorChain: string[];
    refLabel?: string;
};

declare type ResolvedMetroKind = Exclude<MetroPrepareKind, 'auto'>;

declare type ResolvedTarget = {
    kind: 'selector';
    selector: string;
} | {
    kind: 'ref';
    ref: string;
};

declare type ResolveInputOptions = {
    usage: string;
    field?: string;
};

declare const RESPONSE_LEVELS: readonly ['digest', 'default', 'full'];

declare type ResponseCost = {
    wallClockMs: number;
    runnerRoundTrips: number;
    nodeCount?: number;
};

declare type ResponseLevel = (typeof RESPONSE_LEVELS)[number];

declare type RotateCommandOptions = DeviceCommandBaseOptions & {
    orientation: DeviceRotation;
};

/** `rotate` — `{ action: 'rotate', orientation, message: 'Rotated to <orientation>' }`. */
declare type RotateCommandResult = {
    action: 'rotate';
    orientation: DeviceRotation;
    message: string;
};

declare type RotateGestureOptions = DeviceCommandBaseOptions & {
    degrees: number;
    x?: number;
    y?: number;
    velocity?: number;
};

declare type ScreenshotOverlayRef = {
    ref: string;
    label?: string;
    rect: Rect;
    overlayRect: Rect;
    center: Point;
};

declare type ScreenshotResultData = {
    path?: string;
    overlayRefs?: ScreenshotOverlayRef[];
};

declare const SCROLL_DIRECTIONS: readonly ['up', 'down', 'left', 'right'];

declare const SCROLL_INPUT_DIRECTIONS: readonly ['up', 'down', 'left', 'right', 'top', 'bottom'];

declare type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

declare type ScrollInputDirection = (typeof SCROLL_INPUT_DIRECTIONS)[number];

declare type ScrollOptions_2 = DeviceCommandBaseOptions & {
    direction: ScrollInputDirection;
    amount?: number;
    pixels?: number;
    durationMs?: number;
};

declare type SelectorSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'scope' | 'raw'>;

declare type SelectorTarget = {
    selector: string;
    x?: never;
    y?: never;
    ref?: never;
    label?: never;
};

declare const SESSION_ISOLATION_MODES: readonly ['none', 'tenant'];

declare const SESSION_SURFACES: readonly ['app', 'frontmost-app', 'desktop', 'menubar'];

declare type SessionCloseResult = {
    session: string;
    shutdown?: TargetShutdownResult;
    provider?: CloudProviderSessionResult;
    identifiers: AgentDeviceIdentifiers;
};

declare type SessionIsolationMode = (typeof SESSION_ISOLATION_MODES)[number];

declare type SessionRuntimeHints = {
    platform?: 'ios' | 'android';
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    launchUrl?: string;
};

declare type SessionSurface = (typeof SESSION_SURFACES)[number];

declare type SettingsUpdateOptions = (DeviceCommandBaseOptions & {
    setting: 'clear-app-state';
    state: 'clear';
    app?: string;
}) | (DeviceCommandBaseOptions & {
    setting: 'wifi' | 'airplane' | 'location';
    state: 'on' | 'off';
}) | (DeviceCommandBaseOptions & {
    setting: 'location';
    state: 'set';
    latitude: number;
    longitude: number;
}) | (DeviceCommandBaseOptions & {
    setting: 'animations';
    state: 'on' | 'off';
}) | (DeviceCommandBaseOptions & {
    setting: 'appearance';
    state: 'light' | 'dark' | 'toggle';
}) | (DeviceCommandBaseOptions & {
    setting: 'faceid' | 'touchid';
    state: 'match' | 'nonmatch' | 'enroll' | 'unenroll';
}) | (DeviceCommandBaseOptions & {
    setting: 'fingerprint';
    state: 'match' | 'nonmatch';
}) | (DeviceCommandBaseOptions & {
    setting: 'permission';
    state: 'grant' | 'deny' | 'reset';
    permission: PermissionTarget;
    mode?: 'full' | 'limited';
});

/**
 * Closed result of the `shutdown` command. Mirrors the daemon handler's success
 * return EXACTLY (src/daemon/handlers/session-state.ts) — the fixed object
 * literal `{ platform, target, device, id, kind, shutdown }` plus the additive
 * `appleOs` discriminant (Apple devices only). The `shutdown` field is the raw
 * {@link TargetShutdownResult} from `shutdownDeviceTarget`.
 */
declare type ShutdownCommandResult = {
    platform: PublicPlatform;
    target: DeviceTarget;
    /** Human-readable device name (`device.name`). */
    device: string;
    /** Stable device id (`device.id`). */
    id: string;
    kind: DeviceKind;
    shutdown: TargetShutdownResult;
    /**
     * Additive Apple-OS discriminant (`device.appleOs`): iPhone/iPad/tvOS/visionOS/macOS.
     * Present only for Apple devices; absent for non-Apple platforms. `platform` stays the
     * leaf (`ios`/`macos`) — this is an extra field, not a replacement.
     */
    appleOs?: AppleOS;
};

declare type SnapshotCaptureAnalysis = {
    rawNodeCount: number;
    maxDepth: number;
};

declare type SnapshotCaptureAnnotations = {
    analysis?: SnapshotCaptureAnalysis;
    androidSnapshot?: AndroidSnapshotBackendMetadata;
    freshness?: SnapshotCaptureFreshness;
    quality?: SnapshotQualityVerdict;
    warnings?: string[];
};

declare type SnapshotCaptureFreshness = {
    action: string;
    retryCount: number;
    staleAfterRetries: boolean;
    reason?: 'empty-interactive' | 'sharp-drop' | 'stuck-route';
};

declare type SnapshotDiagnosticsSummary = {
    stats: SnapshotTimingStats;
    warning?: string;
};

declare type SnapshotNode = RawSnapshotNode & {
    ref: string;
};

/**
 * Structured quality verdict computed once by the iOS runner's snapshot capture plan.
 * The daemon renders it; it never re-derives degradation from node shapes.
 *
 * Defined here (the foundational snapshot type module) rather than in
 * snapshot-quality.ts so SnapshotNode can reference it without a cyclic import;
 * snapshot-quality.ts (the validation logic) re-exports it for existing callers.
 */
declare type SnapshotQualityVerdict = {
    state: 'healthy' | 'recovered' | 'sparse';
    backend: 'tree' | 'queries' | 'private-ax';
    reason?: string;
    reasonCode?: 'ax-rejected' | 'sparse-tree' | 'budget' | 'no-nodes' | 'capture-failed';
    effectiveDepth?: number;
    collapsedLeafIndexes?: number[];
};

declare type SnapshotTimingStats = {
    count: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    slowThresholdMs: number;
    platform?: PublicPlatform;
    backends?: Record<string, number>;
};

declare type SnapshotUnchanged = {
    ageMs: number;
    nodeCount: number;
    interactiveOnly?: boolean;
    scope?: string;
};

declare type SnapshotVisibility = {
    partial: boolean;
    visibleNodeCount: number;
    totalNodeCount: number;
    reasons: SnapshotVisibilityReason[];
};

declare type SnapshotVisibilityReason = 'offscreen-nodes' | 'scroll-hidden-above' | 'scroll-hidden-below';

declare type StartupPerfSample = {
    durationMs: number;
    measuredAt: string;
    method: string;
    appTarget?: string;
    appBundleId?: string;
};

declare const SWIPE_PATTERNS: readonly ['one-way', 'ping-pong'];

declare const SWIPE_PRESETS: readonly ['left', 'right', 'left-edge', 'right-edge'];

declare type SwipeGestureOptions = DeviceCommandBaseOptions & {
    preset: SwipePreset;
    durationMs?: number;
};

declare type SwipeOptions = DeviceCommandBaseOptions & {
    from: {
        x: number;
        y: number;
    };
    to: {
        x: number;
        y: number;
    };
    durationMs?: number;
    count?: number;
    pauseMs?: number;
    pattern?: SwipePattern;
};

declare type SwipePattern = (typeof SWIPE_PATTERNS)[number];

declare type SwipePreset = (typeof SWIPE_PRESETS)[number];

declare type TargetShutdownResult = {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: NormalizedError;
};

declare type TemporaryFile = {
    path: string;
    visibility: 'internal';
    cleanup: () => Promise<void>;
};

declare type TraceOptions = AgentDeviceRequestOverrides & {
    action: 'start' | 'stop';
    path?: string;
};

declare type TransformGestureOptions = DeviceCommandBaseOptions & TransformGestureParams;

declare type TransformGestureParams = {
    x: number;
    y: number;
    dx: number;
    dy: number;
    scale: number;
    degrees: number;
    durationMs?: number;
};

declare type TypeTextOptions = DeviceCommandBaseOptions & {
    text: string;
    delayMs?: number;
};

declare type ViewportCommandOptions = DeviceCommandBaseOptions & {
    width: number;
    height: number;
};

/**
 * Closed result of the `viewport` command. Mirrors the dispatch handler's return
 * EXACTLY (src/core/dispatch.ts `handleViewportCommand`) — `{ width, height }`
 * plus the always-present `successText` message. The generic dispatch path
 * returns this object unchanged (viewport has no Android dialog guard, so no
 * `warning` is ever appended), so the shape is intentionally closed.
 */
declare type ViewportCommandResult = {
    width: number;
    height: number;
    message: string;
};

declare type WaitCommandOptions = DeviceCommandBaseOptions & WaitCommandTarget;

declare type WaitCommandTarget = {
    durationMs: number;
    text?: never;
    ref?: never;
    selector?: never;
    timeoutMs?: never;
} | (SelectorSnapshotCommandOptions & {
    text: string;
    durationMs?: never;
    ref?: never;
    selector?: never;
    timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
    ref: string;
    durationMs?: never;
    text?: never;
    selector?: never;
    timeoutMs?: number;
}) | (SelectorSnapshotCommandOptions & {
    selector: string;
    durationMs?: never;
    text?: never;
    ref?: never;
    timeoutMs?: number;
});

export { }
