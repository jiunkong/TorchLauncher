/// <reference types="vite/client" />
import type { DesktopApi } from '@torchlauncher/core/desktop';

declare global {
  interface Window {
    torchlauncher: DesktopApi;
  }
}
