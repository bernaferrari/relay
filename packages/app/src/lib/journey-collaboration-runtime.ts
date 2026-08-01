import type { CollaborationAwareness } from "@relay/protocol";
import type * as Y from "yjs";
import {
  CollaborationAwarenessController,
  type LocalCollaborationAwareness,
} from "./collaboration-awareness";
import {
  CollaborationProvider,
  type CollaborationProviderSnapshot,
  type CollaborationScope,
  type CollaborationTransport,
} from "./collaboration-provider";
import type { RelayAwarenessTransport } from "./relay-collaboration-transport";

export type AppCollaborationConfig = Readonly<{
  enabled: boolean;
  displayName?: string;
  avatarToken?: string;
  publishThrottleMs?: number;
  awarenessPollMs?: number;
  awarenessHeartbeatMs?: number;
}>;

export const DEFAULT_APP_COLLABORATION_CONFIG: AppCollaborationConfig = Object.freeze({
  enabled: false,
});

export function normalizeAppCollaborationConfig(
  input: boolean | Partial<AppCollaborationConfig> | undefined,
): AppCollaborationConfig {
  if (typeof input === "boolean") return Object.freeze({ enabled: input });
  return Object.freeze({ ...DEFAULT_APP_COLLABORATION_CONFIG, ...input });
}

export type JourneyCollaborationRuntimeOptions = Readonly<{
  config: AppCollaborationConfig;
  doc: Y.Doc;
  scope: CollaborationScope;
  clientId: string;
  transport?: CollaborationTransport;
  awarenessTransport?: RelayAwarenessTransport;
}>;

/** Owns exactly one document writer/provider and one lossy awareness channel. */
export class JourneyCollaborationRuntime {
  readonly #config: AppCollaborationConfig;
  readonly #provider: CollaborationProvider | undefined;
  readonly #awareness: CollaborationAwarenessController | undefined;

  constructor(options: JourneyCollaborationRuntimeOptions) {
    this.#config = options.config;
    if (!options.config.enabled) return;
    if (!options.transport || !options.awarenessTransport) {
      throw new Error("Enabled collaboration requires document and awareness transports");
    }
    this.#provider = new CollaborationProvider({
      enabled: true,
      doc: options.doc,
      transport: options.transport,
      scope: options.scope,
      clientId: options.clientId,
    });
    this.#awareness = new CollaborationAwarenessController({
      journeyId: options.scope.journeyId,
      transport: options.awarenessTransport,
      ...(options.config.publishThrottleMs
        ? { publishThrottleMs: options.config.publishThrottleMs }
        : {}),
      ...(options.config.awarenessPollMs ? { pollMs: options.config.awarenessPollMs } : {}),
      ...(options.config.awarenessHeartbeatMs
        ? { heartbeatMs: options.config.awarenessHeartbeatMs }
        : {}),
    });
  }

  get enabled(): boolean {
    return this.#config.enabled;
  }

  get providerSnapshot(): CollaborationProviderSnapshot | undefined {
    return this.#provider?.snapshot;
  }

  async start(): Promise<void> {
    if (!this.#provider || !this.#awareness) return;
    this.#awareness.start();
    await this.#provider.start();
  }

  updateAwareness(value: Omit<LocalCollaborationAwareness, "displayName" | "avatarToken">): void {
    this.#awareness?.update({
      ...value,
      ...(this.#config.displayName ? { displayName: this.#config.displayName } : {}),
      ...(this.#config.avatarToken ? { avatarToken: this.#config.avatarToken } : {}),
    });
  }

  subscribeAwareness(listener: (awareness: readonly CollaborationAwareness[]) => void): () => void {
    if (!this.#awareness) {
      listener([]);
      return () => undefined;
    }
    return this.#awareness.subscribe(listener);
  }

  stop(): void {
    this.#awareness?.stop();
    this.#provider?.stop();
  }

  destroy(): void {
    this.#awareness?.destroy();
    this.#provider?.destroy();
  }
}
