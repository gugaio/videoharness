export type StreamCollectionErrorCode =
  | "INVALID_STREAM_URL"
  | "STREAM_DESTINATION_BLOCKED"
  | "STREAM_DNS_FAILED"
  | "STREAM_REQUEST_TIMEOUT"
  | "STREAM_RESPONSE_TOO_LARGE"
  | "STREAM_TOO_MANY_REDIRECTS"
  | "STREAM_HTTP_ERROR"
  | "UNSUPPORTED_MANIFEST";

export class StreamCollectionError extends Error {
  constructor(
    readonly code: StreamCollectionErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StreamCollectionError";
  }
}
