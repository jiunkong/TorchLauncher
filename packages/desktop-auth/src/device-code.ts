import { HostAuthenticationError } from './errors';

/** Fixed trusted destination; provider-supplied URLs never reach the opener. */
export const DEVICE_CODE_LINK_URL = 'https://www.microsoft.com/link';
const CODE_FORMAT = /^[A-Z0-9-]{4,16}$/;

export interface DeviceCodePresenterOptions {
  /** Opens the fixed link in the user's browser (host: `shell.openExternal`). */
  open(url: string): Promise<void> | void;
  /** Writes text to the system clipboard (host: `clipboard.writeText`). */
  copy(text: string): void;
}

/**
 * App-independent holder of the one device code a Microsoft login is waiting for. The host UI
 * subscribes and renders the code; the code exists only while `show` waits and is cleared on
 * abort, finish or failure. It is never logged. No Electron imports: the host injects them.
 */
export class DeviceCodePresenter {
  private current: string | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly options: DeviceCodePresenterOptions) {}

  get code(): string | null {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Copies the pending code through the injected clipboard; false when no code is waiting. */
  copy(): boolean {
    if (this.current === null) return false;
    this.options.copy(this.current);
    return true;
  }

  /** `showCode` for `createDesktopPublicJavaAuthenticator`. */
  async show(code: string, signal: AbortSignal): Promise<void> {
    if (!CODE_FORMAT.test(code)) throw new HostAuthenticationError('browser_failed');
    if (signal.aborted) return;
    this.set(code);
    try {
      await this.options.open(DEVICE_CODE_LINK_URL);
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      // Only clear our own code: a newer login may already have published another one.
      if (this.current === code) this.set(null);
    }
  }

  private set(code: string | null) {
    this.current = code;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A faulty subscriber must not keep a code alive or break the login.
      }
    }
  }
}
