import { uploadInChunks, type ChunkResumeState } from "./chunked-upload.js";
import { sendRequest, type InFlightRequests } from "./transport.js";
import type { FileChunking, UploadItem } from "./types.js";

export type UploadFileOptions = {
  item: UploadItem;
  url: string;
  fileChunking: FileChunking | undefined;
  inFlight: InFlightRequests;
  resumeState: ChunkResumeState;
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
  inFlight,
  resumeState,
  onProgress,
}: UploadFileOptions): Promise<TResponse> {
  if (fileChunking && item.file.size > fileChunking.threshold) {
    return uploadInChunks<TResponse>({
      item,
      chunking: fileChunking,
      inFlight,
      resumeState,
      onProgress,
    });
  }

  const formData = new FormData();
  formData.append("file", item.file);

  return sendRequest<TResponse>({
    inFlight,
    trackingId: item.id,
    endpoint: url,
    formData,
    onProgress,
  });
}
