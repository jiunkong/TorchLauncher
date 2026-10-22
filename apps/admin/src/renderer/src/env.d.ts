/// <reference types="vite/client" />
import type { StudioApi } from '../../shared/studio.js';

declare global {
  interface Window {
    torchlauncher: StudioApi;
  }
}
