import {
  AsyncStorageSessionStore,
  ChannelClient,
  type AsyncStorageLike,
  type ChannelClientOptions,
} from "../client/index.js";

export const MOBILE_SDK_CHANNEL = "mobile-sdk" as const;

export interface MobileChannelClientOptions
  extends Omit<ChannelClientOptions, "channel" | "sessionStore"> {
  /**
   * AsyncStorage-shaped backend. In React Native, pass `AsyncStorage` from
   * `@react-native-async-storage/async-storage`. Tests can inject any object
   * satisfying the `AsyncStorageLike` shape.
   */
  storage: AsyncStorageLike;
  /** Storage key. Defaults to "sevana.sessionId". */
  storageKey?: string;
}

/**
 * Mobile SDK convenience factory.
 *
 * Builds a `ChannelClient` with `channel: "mobile-sdk"` pre-set and an
 * `AsyncStorageSessionStore` backed by the caller's AsyncStorage instance,
 * so session continuity survives across app restarts. The orchestrator
 * core stays unchanged — only the channel adapter differs (PRD §8 / FR-17).
 */
export function createMobileChannelClient(opts: MobileChannelClientOptions): ChannelClient {
  const { storage, storageKey, ...rest } = opts;
  return new ChannelClient({
    ...rest,
    channel: MOBILE_SDK_CHANNEL,
    sessionStore: new AsyncStorageSessionStore(storage, storageKey ? { storageKey } : {}),
  });
}
