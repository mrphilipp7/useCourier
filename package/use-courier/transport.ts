import {
  UploadCancelledError,
  XhrRequestError,
  XhrResponseError,
} from "./errors.js";

/** In-flight requests by file id, so removeFile/unmount can abort them. */
export type InFlightRequests = Map<string, XMLHttpRequest>;

export type SendRequestOptions = {
  /** Where the request is tracked while in flight (one entry per file). */
  inFlight: InFlightRequests;
  trackingId: string;
  endpoint: string;
  formData: FormData;
  onProgress: (percent: number) => void;
  /**
   * false skips the body entirely (any 2xx resolves with undefined) — used
   * for intermediate chunks, whose responses are never read, so a server
   * can answer them with an empty 204.
   */
  parseResponse?: boolean;
};

/**
 * Low-level XHR transport (not fetch, so upload progress events are
 * available): sends formData to endpoint, tracking the in-flight request
 * under trackingId so removeFile/unmount can abort it. Shared by the
 * whole-file path and, per chunk, the chunked-upload path.
 */
export function sendRequest<TResponse>({
  inFlight,
  trackingId,
  endpoint,
  formData,
  onProgress,
  parseResponse = true,
}: SendRequestOptions): Promise<TResponse> {
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
          reject(new XhrResponseError("Response was not valid JSON"));
        }
      } else {
        reject(new XhrResponseError(`Upload failed with status ${xhr.status}`));
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

    xhr.open("POST", endpoint);
    xhr.send(formData);
  });
}
