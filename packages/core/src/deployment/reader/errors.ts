export class DeploymentReaderError extends Error {
  constructor(
    public readonly code:
      | 'invalid-header'
      | 'signature-invalid'
      | 'signature-malformed'
      | 'invalid-signing-key'
      | 'invalid-index-encoding'
      | 'invalid-index-json'
      | 'index-hash-mismatch'
      | 'source-changed'
      | 'file-not-found'
      | 'branding-not-found'
      | 'limit-exceeded'
      | 'invalid-gzip'
      | 'file-hash-mismatch',
    options?: ErrorOptions,
  ) {
    super(`Deployment read failed: ${code}`, options);
    this.name = 'DeploymentReaderError';
  }
}
