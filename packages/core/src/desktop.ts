export type ApplicationKind = 'launcher' | 'studio';

export interface ApplicationInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DesktopApi {
  getApplicationInfo(): Promise<ApplicationInfo>;
}

export const applicationInfoChannel = 'torchlauncher:application-info';

export const applicationNames: Record<ApplicationKind, string> = {
  launcher: 'TorchLauncher',
  studio: 'TorchLauncher Studio',
};

/** Compare the actual document, not just origin (file: origins are all "null"). */
export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);

    if (!['file:', 'http:', 'https:'].includes(expectedUrl.protocol)) {
      return false;
    }

    actualUrl.hash = '';
    actualUrl.search = '';
    expectedUrl.hash = '';
    expectedUrl.search = '';

    return actualUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
}
