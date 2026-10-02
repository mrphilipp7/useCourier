import React from "react";
import { getResumePercent, type ChunkResumeState } from "./chunked-upload.js";
import { FileError } from "./errors.js";
import { createId } from "./ids.js";
import { getOverallUploadState } from "./overall.js";
import type { InFlightRequests } from "./transport.js";
import type {
  OverallUploadState,
  UploadItem,
  UploadResult,
  UseCourierProps,
} from "./types.js";
import { uploadFile } from "./upload-file.js";

/**
 * Generic file-upload hook: tracks files, uploads them via XHR (for progress
 * events), and exposes lifecycle callbacks so consumers can layer their own
 * validation/side effects on top without forking the hook.
 *
 * This file holds everything that touches the hook's state. The stateless
 * pieces live alongside it: the XHR transport (transport.ts), whole-file vs
 * chunked dispatch (upload-file.ts), chunking (chunked-upload.ts), the
 * overall aggregate (overall.ts), and id generation (ids.ts).
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
  /**
   * #21: always-current mirror of files, for lookups in retryUpload and
   * removeFile. Reading files directly there sees whatever it was in the
   * render the caller's closure came from, so a file added via addFile
   * wasn't found until a re-render — including when retryUpload was called
   * from inside onUploadError. Only written through commitFiles.
   */
  const filesRef = React.useRef<UploadItem[]>([]);
  const inFlightRef = React.useRef<InFlightRequests>(new Map());
  const resumeStateRef = React.useRef<ChunkResumeState>(new Map());

  // Abort any uploads still in flight when the consumer unmounts.
  React.useEffect(() => {
    const inFlight = inFlightRef.current;
    return () => {
      inFlight.forEach((xhr) => xhr.abort());
    };
  }, []);

  /**
   * The only way files changes: applies updater to the latest list,
   * synchronously, so filesRef is current immediately rather than after
   * the next render.
   */
  function commitFiles(updater: (prev: UploadItem[]) => UploadItem[]) {
    filesRef.current = updater(filesRef.current);
    setFiles(filesRef.current);
  }

  /** Patches one tracked file's state by id. */
  function updateFile(id: string, updates: Partial<UploadItem>) {
    commitFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  }

  /**
   * Runs the upload for a file and wires the result to state + lifecycle
   * callbacks. Shared by addFile (first attempt) and retryUpload (re-attempt)
   * so both go through identical progress/success/error/finish handling.
   */
  function performUpload(
    item: UploadItem,
  ): Promise<UploadResult<TUploadResponse>> {
    const onProgress = (percent: number) => {
      updateFile(item.id, {
        uploadProgress: Math.round(percent),
        // Bytes fully sent but server hasn't responded yet = processing.
        status: percent >= 100 ? "processing" : "uploading",
      });
    };

    return uploadFile<TUploadResponse>({
      item,
      url,
      fileChunking,
      inFlight: inFlightRef.current,
      resumeState: resumeStateRef.current,
      onProgress,
    })
      .then((data) => {
        updateFile(item.id, { status: "done", uploadProgress: 100 });
        /** Lifecycle hook for any side effects on upload success */
        onUploadSuccess && onUploadSuccess({ item });
        return { success: true as const, data };
      })
      .catch((error: Error) => {
        updateFile(item.id, { status: "error" });
        /** Lifecycle hook for any side effects on upload failure */
        onUploadError && onUploadError({ item, error });
        return { success: false as const, error };
      })
      .finally(() => {
        /** Lifecycle hook for any cleanup/side effects after an upload attempt */
        onUploadFinish && onUploadFinish({ item });
      });
  }

  /** Builds a fresh, untracked UploadItem for a raw File. */
  function createUploadItem(file: File): UploadItem {
    return {
      id: createId(),
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

    const item = createUploadItem(file);

    commitFiles((prev) => [
      ...prev,
      { ...item, status: "uploading", uploadProgress: 0 },
    ]);

    /** Lifecycle hook for pre-upload validation/side effects */
    try {
      beforeUpload && beforeUpload({ item });
    } catch (error) {
      const rejection =
        error instanceof Error ? error : new Error(String(error));
      updateFile(item.id, { status: "error" });
      onUploadError && onUploadError({ item, error: rejection });
      onUploadFinish && onUploadFinish({ item });
      return Promise.resolve({ success: false as const, error: rejection });
    }

    return performUpload(item);
  }

  /**
   * Re-runs the upload for a file currently in the "error" state. Resolves
   * with a failure result (no network call) for any other status, or if
   * onUploadRetry or beforeUpload rejects the retry.
   *
   * #6: for a chunked upload that failed partway through, this resumes from
   * the chunk that failed (see uploadInChunks) rather than restarting the
   * whole file — uploadProgress is set to reflect however much had already
   * been sent, instead of resetting to 0 and immediately jumping back up
   * once the resumed chunk's first progress event arrives.
   */
  function retryUpload(id: string): Promise<UploadResult<TUploadResponse>> {
    const file = filesRef.current.find((f) => f.id === id);
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
      // #26: beforeUpload gates every attempt, not just the first — otherwise
      // a file it rejected (e.g. too large) could be uploaded just by
      // retrying it. Runs last so it's always the final check before a
      // request, same as in addFile.
      beforeUpload && beforeUpload({ item: file });
    } catch (error) {
      const rejection =
        error instanceof Error ? error : new FileError(String(error));
      updateFile(file.id, { status: "error" });
      onUploadError && onUploadError({ item: file, error: rejection });
      onUploadFinish && onUploadFinish({ item: file });
      return Promise.resolve({ success: false as const, error: rejection });
    }

    updateFile(id, {
      status: "uploading",
      uploadProgress: getResumePercent(
        file,
        fileChunking,
        resumeStateRef.current,
      ),
    });
    return performUpload(file);
  }

  /** Drops a file from tracked state by id, aborting its upload if one is in flight. */
  function removeFile(id: string) {
    const file = filesRef.current.find((f) => f.id === id);
    if (!file) return;

    inFlightRef.current.get(id)?.abort();
    // #6: no point resuming a chunked upload for a file that's no longer tracked.
    resumeStateRef.current.delete(id);
    commitFiles((prev) => prev.filter((f) => f.id !== id));
    /** Lifecycle hook for when a file is removed from the upload */
    onRemoveFile && onRemoveFile({ item: file });
  }

  const overall: OverallUploadState = React.useMemo(
    () => getOverallUploadState(files),
    [files],
  );

  return {
    files,
    addFile,
    retryUpload,
    removeFile,
    overall,
  };
}
