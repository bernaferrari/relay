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

declare const DAEMON_SERVER_MODES: readonly ['socket', 'http', 'dual'];

declare const DAEMON_TRANSPORT_PREFERENCES: readonly ['auto', 'socket', 'http'];

declare type DaemonServerMode = (typeof DAEMON_SERVER_MODES)[number];

declare type DaemonTransportPreference = (typeof DAEMON_TRANSPORT_PREFERENCES)[number];

declare const DEVICE_TARGETS: readonly ['mobile', 'tv', 'desktop'];

declare type DeviceTarget = (typeof DEVICE_TARGETS)[number];

declare const LEASE_BACKENDS: readonly ['ios-simulator', 'ios-instance', 'android-instance'];

declare type LeaseBackend = (typeof LEASE_BACKENDS)[number];

declare type MetroPrepareKind = 'auto' | 'react-native' | 'expo';

declare const PLATFORM_SELECTORS: readonly ["apple", "android", "linux", "web", "ios", "macos"];

declare type PlatformSelector = (typeof PLATFORM_SELECTORS)[number];

declare type RemoteConfigMetroOptions = {
    metroProjectRoot?: string;
    metroKind?: MetroPrepareKind;
    metroPublicBaseUrl?: string;
    metroProxyBaseUrl?: string;
    metroBearerToken?: string;
    metroPreparePort?: number;
    metroListenHost?: string;
    metroStatusHost?: string;
    metroStartupTimeoutMs?: number;
    metroProbeTimeoutMs?: number;
    metroRuntimeFile?: string;
    metroNoReuseExisting?: boolean;
    metroNoInstallDeps?: boolean;
};

export declare type RemoteConfigProfile = RemoteConfigMetroOptions & CloudProviderProfileFields & RemoteConnectionProfileFields & {
    platform?: PlatformSelector;
    target?: DeviceTarget;
    device?: string;
    udid?: string;
    serial?: string;
    iosSimulatorDeviceSet?: string;
    androidDeviceAllowlist?: string;
    session?: string;
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

declare const SESSION_ISOLATION_MODES: readonly ['none', 'tenant'];

declare type SessionIsolationMode = (typeof SESSION_ISOLATION_MODES)[number];

export { }
