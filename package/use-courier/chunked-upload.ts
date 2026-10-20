import { UploadCancelledError, XhrResponseError } from "./errors.js";
import { createId } from "./ids.js";
import {
  buildFormData,
  resolveHeaders,
  type RequestOptions,
} from "./request-options.js";
import { sendRequest, type InFlightRequests } from "./transport.js";
import type { FileChunking, UploadItem } from "./types.js";

/**
 * #6: How far a chunked upload got before it failed, by file id, so
 * retryUpload can resume at the chunk that failed instead of restarting
 * the whole file from chunk 0 under a brand-new uploadId. Only ever holds
 * entries for chunked uploads that are currently in the "error" state —
 * see the cleanup in uploadInChunks and removeFile.
 */
export type ChunkResumeState = Map<
  string,
  { uploadId: string; nextChunkIndex: number; chunkSize: number; route: string }
>;

/** The size each chunk is cut to: chunkSize, or threshold if unset. */
export function getChunkSize(chunking: FileChunking) {
  return chunking.chunkSize ?? chunking.threshold;
}

/**
 * Where a retry of this file can pick up, or undefined if it must start
 * over. A resume point only holds for the chunkSize and route that made it:
 * resuming under the same uploadId with chunks cut to a different size, or
 * sent to a different route, would have the server reassemble mismatched
 * byte ranges into a corrupt file.
 */
function getResumePoint(
  item: UploadItem,
  chunking: FileChunking | undefined,
  resumeState: ChunkResumeState,
) {
  const resumeFrom = resumeState.get(item.id);
  if (
    !resumeFrom ||
    !chunking ||
    item.file.size <= chunking.threshold ||
    resumeFrom.chunkSize !== getChunkSize(chunking) ||
    resumeFrom.route !== chunking.route
  ) {
    return undefined;
  }
  return resumeFrom;
}

/**
 * The uploadProgress (0-100) a resumed chunked upload starts from: the
 * share of the file covered by the chunks that already succeeded. 0 when
 * there's nothing to resume.
 */
export function getResumePercent(
  item: UploadItem,
  chunking: FileChunking | undefined,
  resumeState: ChunkResumeState,
) {
  const resumeFrom = getResumePoint(item, chunking, resumeState);
  if (!resumeFrom) return 0;

  return Math.round(
    ((resumeFrom.nextChunkIndex * resumeFrom.chunkSize) / item.file.size) * 100,
  );
}

export type UploadInChunksOptions = {
  item: UploadItem;
  chunking: FileChunking;
  request: RequestOptions;
  inFlight: InFlightRequests;
  resumeState: ChunkResumeState;
  isCancelled: () => boolean;
  onProgress: (percent: number) => void;
};

/**
 * Sends a large file as a sequence of smaller requests instead of one.
 * Each chunk carries uploadId/chunkIndex/totalChunks alongside its bytes
 * so the server can group and reassemble them; the response from the
 * final chunk is treated as the upload's result.
 *
 * #6: resumes a previously-failed attempt for this file instead of always
 * starting over. If resumeState has an entry for this file (left behind by
 * an earlier attempt that exhausted its chunk retries — see below), this
 * reuses that same uploadId and picks up at the chunk that failed, rather
 * than generating a new uploadId and re-sending chunks the server already
 * has. This is safe because the backend contract already keys chunks by
 * uploadId + chunkIndex and reassembles once every index for that uploadId
 * has arrived (see Backend Integration), so resuming under the same
 * uploadId is indistinguishable from the server's perspective from a
 * slower single attempt.
 */
export async function uploadInChunks<TResponse>({
  item,
  chunking,
  request,
  inFlight,
  resumeState,
  isCancelled,
  onProgress,
}: UploadInChunksOptions): Promise<TResponse> {
  const chunkSize = getChunkSize(chunking);
  // #27: chunkSize defaults to threshold, so threshold: 0 with no chunkSize
  // (a natural way to say "chunk everything") gave a chunk size of 0 —
  // Infinity chunks, each an empty request, forever. Fail before sending
  // anything instead. Also catches a negative or NaN chunkSize.
  if (!(Number.isFinite(chunkSize) && chunkSize > 0)) {
    throw new RangeError(
      `fileChunking.chunkSize must be a positive number, got ${chunkSize}. ` +
        "It defaults to threshold, so set chunkSize when threshold is 0.",
    );
  }
  const totalChunks = Math.ceil(item.file.size / chunkSize);
  const maxChunkRetries = chunking.maxChunkRetries ?? 2;

  const resumeFrom = getResumePoint(item, chunking, resumeState);
  // A resume point made with different chunking settings is unusable.
  if (!resumeFrom) resumeState.delete(item.id);
  const uploadId = resumeFrom?.uploadId ?? createId();
  const startChunkIndex = resumeFrom?.nextChunkIndex ?? 0;

  let response: TResponse | undefined;

  for (
    let chunkIndex = startChunkIndex;
    chunkIndex < totalChunks;
    chunkIndex++
  ) {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, item.file.size);
    const chunkBlob = item.file.slice(start, end);
    const chunkBytes = end - start;

    const formData = buildFormData(request, item, chunkBlob, {
      uploadId,
      chunkIndex: String(chunkIndex),
      totalChunks: String(totalChunks),
    });

    // Only the final chunk's response becomes the upload result, so it's
    // the only one that has to be valid JSON.
    const isFinalChunk = chunkIndex === totalChunks - 1;

    const sendChunk = () =>
      sendRequest<TResponse>({
        inFlight,
        trackingId: item.id,
        endpoint: chunking.route,
        formData,
        onProgress: (chunkPercent) => {
          // start = bytes from all prior (always full-size) chunks.
          const bytesSent = start + (chunkPercent / 100) * chunkBytes;
          onProgress((bytesSent / item.file.size) * 100);
        },
        parseResponse: isFinalChunk,
        method: request.method,
        getHeaders: () => resolveHeaders(request, item),
        withCredentials: request.withCredentials,
        isCancelled,
      });

    let attempt = 0;
    while (true) {
      try {
        response = await sendChunk();
        break;
      } catch (error) {
        // A cancellation is intentional — never retry it, propagate immediately.
        // (No need to record resume progress here: removeFile is the only
        // way to cancel, and it removes the file from tracking in the same
        // call, so there's nothing left to resume.)
        if (error instanceof UploadCancelledError) throw error;
        if (attempt >= maxChunkRetries) {
          // #6: out of retries for this chunk — remember where we stopped
          // (same uploadId, this chunkIndex) so a later retryUpload call
          // resumes here instead of re-sending every chunk from scratch.
          resumeState.set(item.id, {
            uploadId,
            nextChunkIndex: chunkIndex,
            chunkSize,
            route: chunking.route,
          });
          throw error;
        }
        attempt++;
      }
    }
  }

  // #6: every chunk made it through — nothing left to resume, so drop any
  // stale marker from an earlier failed attempt for this file.
  resumeState.delete(item.id);

  if (response === undefined) {
    throw new XhrResponseError("No response received from chunked upload");
  }

  return response;
}
