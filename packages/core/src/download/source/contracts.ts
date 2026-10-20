import type {
  ByteRange,
  RangeRequestOptions,
  RangeResponse,
  ResourceSnapshot,
} from '../http/index.js';

export type DownloadSourceKind = 'https' | 'google-drive';

export type DownloadSourceRequestOptions = Omit<
  RangeRequestOptions,
  'headers' | 'fetch' | 'maxRedirects'
>;

export interface DownloadSourceOptions {
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
  maxPageBytes?: number;
}

export interface SourceRangeResponse extends RangeResponse {
  sourceId: string;
  sourceGeneration: number;
}

export interface DownloadSource {
  readonly kind: DownloadSourceKind;
  readonly sourceId: string;
  readonly generation: number;
  readonly snapshot: ResourceSnapshot | undefined;
  getRange(range: ByteRange, options?: DownloadSourceRequestOptions): Promise<SourceRangeResponse>;
  /** Abort outstanding work and begin a new source generation; callers must reread the index. */
  reset(): void;
}
