import { RangeDownloadError } from '../http/index.js';

export class UnsupportedDownloadSourceError extends RangeDownloadError {}

export class DriveLinkResolutionError extends RangeDownloadError {}

export class SourceRestartRequiredError extends RangeDownloadError {
  constructor(
    readonly sourceId: string,
    readonly sourceGeneration: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
