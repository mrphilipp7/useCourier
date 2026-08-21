/** Thrown when an XHR cannot be completed. */
export class XhrRequestError extends Error {
  constructor(message = "An error occurred while making an XMLHttpRequest") {
    super(message);
    this.name = "XhrRequestError";
  }
}

/** Thrown when an XHR receives an unusable response. */
export class XhrResponseError extends Error {
  constructor(message = "An error occurred while receiving an XHR response") {
    super(message);
    this.name = "XhrResponseError";
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
