import type { Readable } from 'node:stream';
import { StdioOptions } from 'node:child_process';
import type { Writable } from 'node:stream';

/**
 * Runs device-scoped adb arguments after the device serial has already been selected.
 * Implementations must be safe to call concurrently for one request.
 */
export declare type AndroidAdbExecutor = (args: string[], options?: AndroidAdbExecutorOptions) => Promise<AndroidAdbExecutorResult>;

export declare type AndroidAdbExecutorOptions = Pick<ExecOptions, 'allowFailure' | 'timeoutMs' | 'binaryStdout' | 'stdin' | 'signal'>;

declare type AndroidAdbExecutorResult = Pick<ExecResult, 'exitCode' | 'stdout' | 'stderr' | 'stdoutBuffer'>;

/**
 * Installs an APK path. Implementations are responsible for honoring semantic
 * install options such as replace/test/downgrade/grant-permissions.
 */
declare type AndroidAdbInstaller = (apkPath: string, options?: AndroidAdbInstallOptions) => Promise<AndroidAdbExecutorResult>;

declare type AndroidAdbInstallOptions = AndroidAdbTransferOptions & {
    replace?: boolean;
    allowTestPackages?: boolean;
    allowDowngrade?: boolean;
    grantPermissions?: boolean;
};

declare type AndroidAdbProcess = {
    pid?: number;
    stdin: Writable | null;
    stdout: Readable | null;
    stderr: Readable | null;
    killed: boolean;
    kill(signal?: NodeJS.Signals | number): boolean;
    once(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'exit' | 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};

declare type AndroidAdbProvider = {
    /**
     * Fallback executor for device-scoped adb arguments. Providers may omit explicit
     * methods to keep the legacy exec-shaped pull/install fallback.
     */
    exec: AndroidAdbExecutor;
    spawn?: AndroidAdbSpawner;
    reverse?: AndroidPortReverseProvider;
    pull?: AndroidAdbPuller;
    install?: AndroidAdbInstaller;
    installBundle?: AndroidBundleInstaller;
    text?: AndroidTextInjector;
    touch?: AndroidTouchInjector;
};

declare type AndroidAdbPuller = (remotePath: string, localPath: string, options?: AndroidAdbTransferOptions) => Promise<AndroidAdbExecutorResult>;

declare type AndroidAdbSpawner = (args: string[], options?: ExecBackgroundOptions) => AndroidAdbProcess;

declare type AndroidAdbTransferOptions = AndroidAdbExecutorOptions;

declare type AndroidAppListFilter = AppsFilter;

declare type AndroidAppListOptions = {
    filter?: AndroidAppListFilter;
    target?: AndroidAppListTarget;
};

declare type AndroidAppListTarget = 'mobile' | 'tv' | 'auto';

declare type AndroidBundleInstaller = (bundlePath: string, options: {
    mode: string;
}) => Promise<void>;

declare type AndroidForegroundApp = {
    package?: string;
    activity?: string;
};

declare type AndroidInputOwner = 'app' | 'ime' | 'unknown';

declare type AndroidKeyboardDismissResult = AndroidKeyboardState & {
    attempts: number;
    wasVisible: boolean;
    dismissed: boolean;
};

declare type AndroidKeyboardState = {
    visible: boolean;
    inputType?: string;
    type?: AndroidKeyboardType;
    inputMethodPackage?: string;
    focusedPackage?: string;
    focusedResourceId?: string;
    inputOwner: AndroidInputOwner;
};

declare type AndroidKeyboardType = 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';

declare type AndroidLogcatCaptureOptions = {
    lines?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
};

declare type AndroidOpenAppWithAdbOptions = {
    activity?: string;
    category?: string;
};

export declare type AndroidPortReverseEndpoint = `tcp:${number}` | `localabstract:${string}`;

declare type AndroidPortReverseMapping = {
    local: AndroidPortReverseEndpoint;
    remote: AndroidPortReverseEndpoint;
    ownerId?: string;
};

declare type AndroidPortReverseOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
};

declare type AndroidPortReverseProvider = {
    ensure(mapping: AndroidPortReverseMapping, options?: AndroidPortReverseOptions): Promise<void>;
    remove(local: AndroidPortReverseEndpoint, options?: AndroidPortReverseOptions): Promise<void>;
    removeAllOwned(ownerId: string, options?: AndroidPortReverseOptions): Promise<void>;
    list?(options?: AndroidPortReverseOptions): Promise<AndroidPortReverseMapping[]>;
};

declare type AndroidTextInjectionRequest = {
    action: AndroidTextInputAction;
    text: string;
    delayMs?: number;
    /**
     * Present only for fill. Providers must make this target the focused/replaced
     * input for the request, not inject into an unrelated currently focused field.
     */
    target?: {
        x: number;
        y: number;
    };
};

declare type AndroidTextInjector = (request: AndroidTextInjectionRequest) => Promise<void>;

declare type AndroidTextInputAction = 'type' | 'fill';

declare type AndroidTouchGestureRequest = {
    kind: 'swipe';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs?: number;
} | {
    kind: 'pinch';
    x: number;
    y: number;
    scale: number;
    durationMs?: number;
} | {
    kind: 'rotate';
    x: number;
    y: number;
    degrees: number;
    durationMs?: number;
} | {
    kind: 'transform';
    x: number;
    y: number;
    dx: number;
    dy: number;
    scale: number;
    degrees: number;
    durationMs?: number;
};

declare type AndroidTouchInjector = (request: AndroidTouchGestureRequest) => Promise<Record<string, unknown> | void>;

declare type AppsFilter = 'user-installed' | 'all';

export declare function captureAndroidLogcatWithAdb(adb: AndroidAdbExecutor, options?: AndroidLogcatCaptureOptions): Promise<string>;

export declare function createAndroidPortReverseManager(provider: AndroidAdbProvider | AndroidAdbExecutor): AndroidPortReverseProvider;

export declare function dismissAndroidKeyboardWithAdb(adb: AndroidAdbExecutor): Promise<AndroidKeyboardDismissResult>;

declare type ExecBackgroundOptions = ExecOptions & {
    /**
     * Capture stdout/stderr into the wait result when the child has piped stdio.
     * Set false when the caller owns, ignores, or forwards the streams.
     */
    captureOutput?: boolean;
    stdio?: StdioOptions;
};

declare type ExecOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
    binaryStdout?: boolean;
    stdin?: string | Buffer;
    timeoutMs?: number;
    detached?: boolean;
    signal?: AbortSignal;
    /** Max stdout/stderr bytes for synchronous runs (default Node ~1MB). */
    maxBuffer?: number;
};

declare type ExecResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    stdoutBuffer?: Buffer;
};

export declare function forceStopAndroidAppWithAdb(adb: AndroidAdbExecutor, packageName: string): Promise<void>;

export declare function getAndroidAppStateWithAdb(adb: AndroidAdbExecutor): Promise<AndroidForegroundApp>;

export declare function getAndroidKeyboardStatusWithAdb(adb: AndroidAdbExecutor): Promise<AndroidKeyboardState>;

export declare function listAndroidAppsWithAdb(adb: AndroidAdbExecutor, options?: AndroidAppListOptions): Promise<Array<{
    package: string;
    name: string;
}>>;

export declare function openAndroidAppWithAdb(adb: AndroidAdbExecutor, packageName: string, options?: AndroidOpenAppWithAdbOptions): Promise<void>;

export declare function readAndroidClipboardWithAdb(adb: AndroidAdbExecutor): Promise<string>;

export declare function writeAndroidClipboardWithAdb(adb: AndroidAdbExecutor, text: string): Promise<void>;

export { }
