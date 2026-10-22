/// <reference types="vite/client" />
import type { LauncherApi } from '../../shared/product';

declare global {
  interface Window {
    torchlauncher: LauncherApi;
  }
}
