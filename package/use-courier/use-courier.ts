import React from "react";
import {
  FileError,
  UploadCancelledError,
  XhrRequestError,
  XhrResponseError,
} from "./errors.js";
import type {
  FileChunking,
  UploadItem,
  UploadResult,
  UseCourierProps,
} from "./types.js";

/**
 * Generic file-upload hook: tracks files, uploads them via XHR (for progress
 * events), and exposes lifecycle callbacks so consumers can layer their own
 * validation/side effects on top without forking the hook.
 */
export function useCourier<TUploadResponse>({
  url,
  beforeUpload,
  onUploadSuccess,
  onUploadError,
  onUploadFinish,
  onUploadRetry,
  onRemoveFile,
  fileChunking,
}: UseCourierProps) {
  const [files, setFiles] = React.useState<UploadItem[]>([]);
  const URL = url;
  const xhrsRef = React.useRef<Map<string, XMLHttpRequest>>(new Map());

  // Abort any uploads still in flight when the consumer unmounts.
  React.useEffect(() => {
    return () => {
      xhrsRef.current.forEach((xhr) => xhr.abort());
    };
  }, []);

  /** Patches one tracked file's state by id. */
  function updateFile(id: string, updates: Partial<UploadItem>) {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  }

  /**
   * Low-level XHR transport (not fetch, so upload progress events are
   * available): sends formData to endpoint, tracking the in-flight request
   * under trackingId so removeFile/unmount can abort it. Shared by the
   * whole-file path (runUpload) and, per chunk, the chunked-upload path.
   */
  function sendRequest(
    trackingId: string,
    endpoint: string,
    formData: FormData,
    onProgress: (percent: number) => void,
  ): Promise<TUploadResponse> {
    return new Promise<TUploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrsRef.current.set(trackingId, xhr);

      const cleanup = () => xhrsRef.current.delete(trackingId);

      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;

        const percent = (event.loaded / event.total) * 100;

        onProgress(percent);
      });

      xhr.addEventListener("load", () => {
        cleanup();
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as TUploadResponse);
        } else {
          reject(
            new XhrResponseError(`Upload failed with status ${xhr.status}`),
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

      xhr.open("POST", endpoint);
      xhr.send(formData);
    });
  }

  /** Sends the whole file in one request via sendRequest. */
  function runUpload(
    uploadedFile: UploadItem,
    onProgress: (percent: number) => void,
  ): Promise<TUploadResponse> {
    const formData = new FormData();
    formData.append("file", uploadedFile.file);

    return sendRequest(uploadedFile.id, URL, formData, onProgress);
  }

  /**
   * Sends a large file as a sequence of smaller requests instead of one.
   * Each chunk carries uploadId/chunkIndex/totalChunks alongside its bytes
   * so the server can group and reassemble them; the response from the
   * final chunk is treated as the upload's result.
   */
  async function runChunkedUpload(
    uploadedFile: UploadItem,
    onProgress: (percent: number) => void,
    chunking: FileChunking,
  ): Promise<TUploadResponse> {
    const chunkSize = chunking.chunkSize ?? chunking.threshold;
    const totalChunks = Math.ceil(uploadedFile.file.size / chunkSize);
    const uploadId = crypto.randomUUID();
    const maxChunkRetries = chunking.maxChunkRetries ?? 2;

    let response: TUploadResponse | undefined;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, uploadedFile.file.size);
      const chunkBlob = uploadedFile.file.slice(start, end);
      const chunkBytes = end - start;

      const formData = new FormData();
      formData.append("file", chunkBlob, uploadedFile.file.name);
      formData.append("uploadId", uploadId);
      formData.append("chunkIndex", String(chunkIndex));
      formData.append("totalChunks", String(totalChunks));

      const sendChunk = () =>
        sendRequest(
          uploadedFile.id,
          chunking.route,
          formData,
          (chunkPercent) => {
            // start = bytes from all prior (always full-size) chunks.
            const bytesSent = start + (chunkPercent / 100) * chunkBytes;
            onProgress((bytesSent / uploadedFile.file.size) * 100);
          },
        );

      let attempt = 0;
      while (true) {
        try {
          response = await sendChunk();
          break;
        } catch (error) {
          // A cancellation is intentional — never retry it, propagate immediately.
          if (error instanceof UploadCancelledError) throw error;
          if (attempt >= maxChunkRetries) throw error;
          attempt++;
        }
      }
    }

    if (response === undefined) {
      throw new XhrResponseError("No response received from chunked upload");
    }

    return response;
  }

  /**
   * Runs the upload for a file and wires the result to state + lifecycle
   * callbacks. Shared by addFile (first attempt) and retryUpload (re-attempt)
   * so both go through identical progress/success/error/finish handling.
   */
  function performUpload(
    uploadFile: UploadItem,
  ): Promise<UploadResult<TUploadResponse>> {
    const onProgress = (percent: number) => {
      updateFile(uploadFile.id, {
        uploadProgress: Math.round(percent),
        // Bytes fully sent but server hasn't responded yet = processing.
        status: percent >= 100 ? "processing" : "uploading",
      });
    };

    const upload =
      fileChunking && uploadFile.file.size > fileChunking.threshold
        ? runChunkedUpload(uploadFile, onProgress, fileChunking)
        : runUpload(uploadFile, onProgress);

    return upload
      .then((data) => {
        updateFile(uploadFile.id, { status: "done", uploadProgress: 100 });
        /** Lifecycle hook for any side effects on upload success */
        onUploadSuccess && onUploadSuccess({ item: uploadFile });
        return { success: true as const, data };
      })
      .catch((error: Error) => {
        updateFile(uploadFile.id, { status: "error" });
        /** Lifecycle hook for any side effects on upload failure */
        onUploadError && onUploadError({ item: uploadFile, error });
        return { success: false as const, error };
      })
      .finally(() => {
        /** Lifecycle hook for any cleanup/side effects after an upload attempt */
        onUploadFinish && onUploadFinish({ item: uploadFile });
      });
  }

  /** Builds a fresh, untracked UploadItem for a raw File. */
  function createUploadFile(file: File): UploadItem {
    return {
      id: crypto.randomUUID(),
      file: file,
      status: "idle",
      uploadProgress: 0,
    };
  }

  /** Adds a file, runs beforeUpload, and starts its upload. A beforeUpload rejection only fails this one file — safe to call in a loop over multiple files. */
  function addFile(file: File): Promise<UploadResult<TUploadResponse>> {
    if (!(file instanceof File)) {
      return Promise.resolve({
        success: false as const,
        error: new FileError("Invalid file provided"),
      });
    }

    const uploadFile = createUploadFile(file);

    setFiles((prev) => [
      ...prev,
      { ...uploadFile, status: "uploading", uploadProgress: 0 },
    ]);

    /** Lifecycle hook for pre-upload validation/side effects */
    try {
      beforeUpload && beforeUpload({ item: uploadFile });
    } catch (error) {
      const rejection =
        error instanceof Error ? error : new Error(String(error));
      updateFile(uploadFile.id, { status: "error" });
      onUploadError && onUploadError({ item: uploadFile, error: rejection });
      onUploadFinish && onUploadFinish({ item: uploadFile });
      return Promise.resolve({ success: false as const, error: rejection });
    }

    return performUpload(uploadFile);
  }

  /** Re-runs the upload for a file currently in the "error" state. Resolves with a failure result (no network call) for any other status. */
  function retryUpload(id: string): Promise<UploadResult<TUploadResponse>> {
    const file = files.find((f) => f.id === id);
    if (!file) {
      return Promise.resolve({
        success: false as const,
        error: new FileError(`File with id ${id} not found`),
      });
    }

    if (file.status !== "error") {
      return Promise.resolve({
        success: false as const,
        error: new FileError(`File with id ${id} is not in an error state`),
      });
    }

    /** Lifecycle hook for retrying an upload */
    try {
      onUploadRetry && onUploadRetry({ item: file });
    } catch (error) {
      const rejection =
        error instanceof Error ? error : new FileError(String(error));
      updateFile(file.id, { status: "error" });
      onUploadError && onUploadError({ item: file, error: rejection });
      onUploadFinish && onUploadFinish({ item: file });
      return Promise.resolve({ success: false as const, error: rejection });
    }

    updateFile(id, { status: "uploading", uploadProgress: 0 });
    return performUpload(file);
  }

  /** Drops a file from tracked state by id, aborting its upload if one is in flight. */
  function removeFile(id: string) {
    const file = files.find((f) => f.id === id);
    if (!file) return;

    xhrsRef.current.get(id)?.abort();
    setFiles((prev) => prev.filter((f) => f.id !== id));
    /** Lifecycle hook for when a file is removed from the upload */
    onRemoveFile && onRemoveFile({ item: file });
  }

  return {
    files,
    addFile,
    retryUpload,
    removeFile,
  };
}
