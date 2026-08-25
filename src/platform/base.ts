// The one door everything host-specific goes through.
//
// ⚠ **One interface, one implementation per target, chosen at build time — never a runtime `if`.**
// CrazyGames forbids third-party ad networks outright, so a single line of another store's SDK
// inside the uploaded build is a compliance failure. Splitting at the bundler makes that
// guarantee structural instead of something to keep remembering, and it is provable:
//
//   VITE_TARGET=web npm run build && grep -rc crazygames dist/   # must be 0
//
// `index.ts` picks by alias, so the implementation you did not select never enters the module
// graph at all — stronger than trusting dead-code elimination to fold an `if`.

/** Same shape as `localStorage`, so call sites do not care which one they got. */
export interface PlatformStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Platform {
  /** For logging and for the version badge — never branched on. */
  readonly name: string;

  /**
   * Bring the host SDK up. **Never throws and never hangs**: an adblocker that swallows the SDK
   * script does not fire `onerror`, so the implementation owns its own timeout.
   */
  init(): Promise<void>;

  /**
   * Progress storage. ⚠ Nothing may read this before `init()` resolves — the host preloads the
   * player's cloud save *during* init, so an early read returns the local copy and the next
   * write pushes that stale copy over their real save.
   */
  readonly storage: PlatformStorage;

  /** Bracket the asset load, so the host can show its own spinner. */
  loadingStart(): void;
  loadingStop(): void;

  /**
   * ⚠ Not telemetry — this is how the host knows **when it is allowed to interrupt with an ad**.
   * Every pause, modal and menu has to be bracketed, or an ad lands in the middle of a turn.
   * Emit from the pause *flag* rather than from each call site: the one call site you miss is
   * the one that breaks it.
   */
  gameplayStart(): void;
  gameplayStop(): void;

  /** A flourish on the host page when the player does well. */
  happytime(): void;

  /** The player's language per the host, or null if it cannot say. */
  preferredLang(): string | null;

  /**
   * ⚠ The host's mute button **outranks the in-game one**. An in-game toggle must not be able to
   * bring audio back while the host has muted us.
   */
  hostMuted(): boolean;
  onHostMuteChange(cb: (muted: boolean) => void): void;
}

/** A storage that works when `localStorage` throws — private mode, or a sandboxed frame. */
export const localStore: PlatformStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — progress just will not persist */
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
};
