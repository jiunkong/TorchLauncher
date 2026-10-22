export const brandingChannel = 'launcher:branding';
export const brandingChangedChannel = 'launcher:branding-changed';

/** Verified encoded image bytes only: no filesystem locations, source URLs or original errors. */
export interface BrandingSnapshot {
  readonly revision: number;
  readonly appName: string;
  readonly icon: string | null;
  readonly background: string | null;
}
export interface BrandingApi {
  getBranding?(): Promise<BrandingSnapshot>;
  onBranding?(listener: (snapshot: BrandingSnapshot) => void): () => void;
}
