import {
  UploadCancelledError,
  XhrRequestError,
  XhrResponseError,
} from "./errors.js";
import type { UploadHeaders } from "./types.js";

/** In-flight requests by file id, so removeFile/unmount can abort them. */
export type InFlightRequests = Map<string, XMLHttpRequest>;

export type SendRequestOptions = {
  /** Where the request is tracked while in flight (one entry per file). */
  inFlight: InFlightRequests;
  trackingId: string;
  endpoint: string;
  formData: FormData;
  onProgress: (percent: number) => void;
  /** Defaults to "POST". */
  method?: string;
  /** Called once, right before the request opens. May return a promise. */
  getHeaders?: () => UploadHeaders | Promise<UploadHeaders>;
  withCredentials?: boolean;
  /**
   * Checked after async headers resolve. There's no request yet to abort
   * while they're pending, so this is how a removeFile/unmount during that
   * wait still cancels the upload instead of letting it start.
   */
  isCancelled?: () => boolean;
  /**
   * false skips the body entirely (any 2xx resolves with undefined) — used
   * for intermediate chunks, whose responses are never read, so a server
   * can answer them with an empty 204.
   */
  parseResponse?: boolean;
};

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>)?.then === "function";
}

/**
 * Low-level XHR transport (not fetch, so upload progress events are
 * available): sends formData to endpoint, tracking the in-flight request
 * under trackingId so removeFile/unmount can abort it. Shared by the
 * whole-file path and, per chunk, the chunked-upload path.
 *
 * #20: only waits before opening the request when getHeaders returns a
 * promise. Static (or synchronously computed) headers open it immediately,
 * same as before headers existed.
 */
export function sendRequest<TResponse>(
  options: SendRequestOptions,
): Promise<TResponse> {
  let headers: UploadHeaders | Promise<UploadHeaders>;
  try {
    headers = options.getHeaders?.() ?? {};
  } catch (error) {
    return Promise.reject(error);
  }

  if (!isPromiseLike(headers)) {
    return openRequest<TResponse>(options, headers);
  }

  return Promise.resolve(headers).then((resolved) => {
    if (options.isCancelled?.()) throw new UploadCancelledError();
    return openRequest<TResponse>(options, resolved);
  });
}

function openRequest<TResponse>(
  {
    inFlight,
    trackingId,
    endpoint,
    formData,
    onProgress,
    method = "POST",
    withCredentials = false,
    parseResponse = true,
  }: SendRequestOptions,
  headers: UploadHeaders,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    inFlight.set(trackingId, xhr);

    const cleanup = () => inFlight.delete(trackingId);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;

      const percent = (event.loaded / event.total) * 100;

      onProgress(percent);
    });

    xhr.addEventListener("load", () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        if (!parseResponse) {
          resolve(undefined as TResponse);
          return;
        }
        // #18: a throw here would escape the listener and leave the
        // promise pending forever, so a non-JSON body (empty 204, plain
        // text, an HTML proxy page) must reject instead.
        try {
          resolve(JSON.parse(xhr.responseText) as TResponse);
        } catch {
          reject(
            new XhrResponseError("Response was not valid JSON", {
              status: xhr.status,
              body: xhr.responseText,
            }),
          );
        }
      } else {
        reject(
          new XhrResponseError(`Upload failed with status ${xhr.status}`, {
            status: xhr.status,
            body: xhr.responseText,
          }),
        );
      }
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new XhrRequestError("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new UploadCancelledError());
    });

    xhr.open(method, endpoint);
    // Headers and withCredentials can only be set after open().
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.withCredentials = withCredentials;
    xhr.send(formData);
  });
}
