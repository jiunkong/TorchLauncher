import { EncryptedAuthStore, type EncryptedAuthStoreOptions } from './encrypted-store';
import { type JavaCacheSnapshot, snapshot } from './public-java-protocol';

const key = 'torchlauncher.public-java.v1';

export interface JavaCacheStore {
  read(): Promise<JavaCacheSnapshot | null>;
  write(value: JavaCacheSnapshot): Promise<void>;
  clear(): Promise<void>;
}

/** Dedicated directory and key; never shares an own-app OAuth session. */
export class EncryptedPublicJavaCache implements JavaCacheStore {
  private readonly store: EncryptedAuthStore<JavaCacheSnapshot>;

  constructor(options: EncryptedAuthStoreOptions) {
    this.store = new EncryptedAuthStore(options, snapshot, /^torchlauncher\.public-java\.v1$/);
  }

  read() {
    return this.store.read(key);
  }
  write(value: JavaCacheSnapshot) {
    return this.store.write(key, value);
  }
  clear() {
    return this.store.clear(key);
  }
}
