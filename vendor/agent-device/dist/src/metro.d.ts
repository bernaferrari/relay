export declare function buildBundleUrl(baseUrl: string, platform: 'ios' | 'android'): string;

export declare type MetroBridgeDescriptor = {
    enabled: boolean;
    base_url: string;
    status_url?: string;
    bundle_url?: string;
    ios_runtime: MetroBridgeRuntimePayload;
    android_runtime: MetroBridgeRuntimePayload;
    upstream: {
        bundle_url?: string;
        host?: string;
        port?: number;
        status_url?: string;
    };
    probe: {
        reachable: boolean;
        status_code: number;
        latency_ms: number;
        detail: string;
    };
};

declare type MetroBridgeRuntimePayload = {
    metro_host?: string;
    metro_port?: number;
    metro_bundle_url?: string;
    launch_url?: string;
};

declare type MetroTunnelHttpErrorMessage = {
    type: 'http-error';
    requestId: string;
    message: string;
};

declare type MetroTunnelHttpRequestMessage = {
    type: 'http-request';
    requestId: string;
    method: string;
    path: string;
    headers?: Record<string, string>;
    bodyBase64?: string;
};

declare type MetroTunnelHttpResponseMessage = {
    type: 'http-response';
    requestId: string;
    status: number;
    headers: Record<string, string>;
    bodyBase64?: string;
};

declare type MetroTunnelPingMessage = {
    type: 'ping';
    timestamp: number;
};

declare type MetroTunnelPongMessage = {
    type: 'pong';
    timestamp: number;
};

export declare type MetroTunnelRequestMessage = MetroTunnelPingMessage | MetroTunnelHttpRequestMessage | MetroTunnelWebSocketOpenMessage | MetroTunnelWebSocketFrameMessage | MetroTunnelWebSocketCloseMessage;

export declare type MetroTunnelResponseMessage = MetroTunnelPongMessage | MetroTunnelHttpResponseMessage | MetroTunnelHttpErrorMessage | MetroTunnelWebSocketOpenResultMessage | MetroTunnelWebSocketFrameMessage | MetroTunnelWebSocketCloseMessage;

declare type MetroTunnelWebSocketCloseMessage = {
    type: 'ws-close';
    streamId: string;
    code?: number;
    reason?: string;
};

declare type MetroTunnelWebSocketFrameMessage = {
    type: 'ws-frame';
    streamId: string;
    dataBase64: string;
    binary: boolean;
};

declare type MetroTunnelWebSocketOpenMessage = {
    type: 'ws-open';
    streamId: string;
    path: string;
    headers?: Record<string, string>;
};

declare type MetroTunnelWebSocketOpenResultMessage = {
    type: 'ws-open-result';
    streamId: string;
    success: boolean;
    headers?: Record<string, string>;
    error?: string;
};

export declare function normalizeBaseUrl(input: string): string;

export declare function resolveRuntimeTransport(runtime: SessionRuntimeHints | undefined): {
    host: string;
    port: number;
    scheme: 'http' | 'https';
} | undefined;

declare type SessionRuntimeHints = {
    platform?: 'ios' | 'android';
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    launchUrl?: string;
};

export { }
