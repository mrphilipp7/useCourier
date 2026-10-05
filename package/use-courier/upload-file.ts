import { uploadInChunks, type ChunkResumeState } from "./chunked-upload.js";
import {
  buildFormData,
  resolveHeaders,
  type RequestOptions,
} from "./request-options.js";
import { sendRequest, type InFlightRequests } from "./transport.js";
import type { FileChunking, UploadItem } from "./types.js";

export type UploadFileOptions = {
  item: UploadItem;
  url: string;
  fileChunking: FileChunking | undefined;
  request: RequestOptions;
  inFlight: InFlightRequests;
  resumeState: ChunkResumeState;
  isCancelled: () => boolean;
  onProgress: (percent: number) => void;
};

/**
 * Sends one file and resolves with the server's response: in chunks if
 * fileChunking is set and the file is larger than its threshold, otherwise
 * as a single whole-file request to url.
 */
export function uploadFile<TResponse>({
  item,
  url,
  fileChunking,
  request,
  inFlight,
  resumeState,
  isCancelled,
  onProgress,
}: UploadFileOptions): Promise<TResponse> {
  if (fileChunking && item.file.size > fileChunking.threshold) {
    return uploadInChunks<TResponse>({
      item,
      chunking: fileChunking,
      request,
      inFlight,
      resumeState,
      isCancelled,
      onProgress,
    });
  }

  let formData: FormData;
  try {
    formData = buildFormData(request, item, item.file);
  } catch (error) {
    // A throwing formFields function fails the upload, not addFile itself.
    return Promise.reject(error);
  }

  return sendRequest<TResponse>({
    inFlight,
    trackingId: item.id,
    endpoint: url,
    formData,
    onProgress,
    method: request.method,
    getHeaders: () => resolveHeaders(request, item),
    withCredentials: request.withCredentials,
    isCancelled,
  });
}
