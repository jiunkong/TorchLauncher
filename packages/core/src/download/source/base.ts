import {
  type ByteRange,
  HttpRangeClient,
  type RangeRequestOptions,
  type RangeResponse,
  RemoteResourceChangedError,
  type ResourceSnapshot,
} from '../http/index.js';
import type {
  DownloadSourceKind,
  DownloadSourceRequestOptions,
  SourceRangeResponse,
} from './contracts.js';
import { SourceRestartRequiredError } from './errors.js';

export abstract class BaseDownloadSource {
  private generationValue = 0;
  private generationController = new AbortController();
  private restartRequired: unknown;
  protected rangeClient = new HttpRangeClient();

  protected constructor(
    readonly kind: DownloadSourceKind,
    readonly sourceId: string,
    private readonly fetcher: typeof globalThis.fetch,
    private readonly maxRedirects: number,
  ) {}

  get generation(): number {
    return this.generationValue;
  }

  get snapshot(): ResourceSnapshot | undefined {
    return this.rangeClient.snapshot;
  }

  reset(): void {
    this.generationController.abort(new Error('Download source reset'));
    this.generationValue += 1;
    this.generationController = new AbortController();
    this.rangeClient = new HttpRangeClient();
    this.restartRequired = undefined;
    this.onReset();
  }

  protected async transferRange(
    url: URL,
    range: ByteRange,
    options: DownloadSourceRequestOptions = {},
    headers?: RangeRequestOptions['headers'],
  ): Promise<SourceRangeResponse> {
    this.assertActive();
    const generation = this.generationValue;
    const client = this.rangeClient;
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.generationController.signal])
      : this.generationController.signal;

    try {
      const response: RangeResponse = await client.getRange(url, range, {
        ...options,
        headers,
        fetch: this.fetcher,
        maxRedirects: this.maxRedirects,
        signal,
      });
      if (generation !== this.generationValue || this.restartRequired !== undefined) {
        throw this.createRestartError(this.restartRequired);
      }
      return { ...response, sourceId: this.sourceId, sourceGeneration: generation };
    } catch (error) {
      if (this.restartRequired !== undefined || generation !== this.generationValue) {
        throw this.createRestartError(this.restartRequired ?? error);
      }
      if (error instanceof RemoteResourceChangedError) {
        this.requireRestart(error);
        throw this.createRestartError(error);
      }
      throw error;
    }
  }

  protected requireRestart(reason: unknown): void {
    if (this.restartRequired !== undefined) return;
    this.restartRequired = reason;
    this.generationValue += 1;
    this.generationController.abort(reason);
  }

  protected assertActive(): void {
    if (this.restartRequired !== undefined) {
      throw this.createRestartError(this.restartRequired);
    }
  }

  protected sourceSignal(signal?: AbortSignal): AbortSignal {
    return signal
      ? AbortSignal.any([signal, this.generationController.signal])
      : this.generationController.signal;
  }

  protected restartSource(reason: unknown): SourceRestartRequiredError {
    this.requireRestart(reason);
    return this.createRestartError(reason);
  }

  protected onReset(): void {}

  protected createRestartError(reason: unknown): SourceRestartRequiredError {
    return new SourceRestartRequiredError(
      this.sourceId,
      this.generationValue,
      'The source changed or expired; discard outstanding ranges, reset the source, and reread its index',
      reason instanceof Error ? { cause: reason } : undefined,
    );
  }
}
