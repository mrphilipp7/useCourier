/** Thrown when an XHR cannot be completed. */
export class XhrRequestError extends Error {
  constructor(message = "An error occurred while making an XMLHttpRequest") {
    super(message);
    this.name = "XhrRequestError";
  }
}

/**
 * Thrown when an XHR receives an unusable response: a non-2xx status, or a
 * 2xx whose body isn't valid JSON. status and body let consumers tell, say,
 * a 401 or 413 apart from a 500.
 */
export class XhrResponseError extends Error {
  /** The response's HTTP status, or 0 if there wasn't one. */
  readonly status: number;
  /** The raw response body text ("" if there wasn't one). */
  readonly body: string;

  constructor(
    message = "An error occurred while receiving an XHR response",
    { status = 0, body = "" }: { status?: number; body?: string } = {},
  ) {
    super(message);
    this.name = "XhrResponseError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when an upload is intentionally cancelled. */
export class UploadCancelledError extends Error {
  constructor(message = "The upload was cancelled") {
    super(message);
    this.name = "UploadCancelledError";
  }
}

/** Thrown when a file is invalid or cannot be used for an upload. */
export class FileError extends Error {
  constructor(message = "An error occurred while handling a file") {
    super(message);
    this.name = "FileError";
  }
}
