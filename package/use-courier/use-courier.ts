import React from "react";
import { notify } from "./callbacks.js";
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
import { useLatest } from "./use-latest.js";

/**
 * Generic file-upload hook: tracks files, uploads them via XHR (for progress
 * events), and exposes lifecycle callbacks so consumers can layer their own
 * validation/side effects on top without forking the hook.
 *
 * This file holds everything that touches the hook's state. The stateless
 * pieces live alongside it: the XHR transport (transport.ts), whole-file vs
 * chunked dispatch (upload-file.ts), chunking (chunked-upload.ts), the
 * overall aggregate (overall.ts), id generation (ids.ts), and safe callback
 * invocation (callbacks.ts).
 */
export function useCourier<TUploadResponse>(props: UseCourierProps) {
  /**
   * #29: url, fileChunking, and every callback are read through this, never
   * from props directly. An upload (or a retryUpload/removeFile reference
   * held by a callback) outlives the render it came from, and that render's
   * props would be stale by the time it finishes.
   */
  const optionsRef = useLatest(props);

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
   * #19: the file as it is right now, for passing to callbacks — so a
   * callback's item matches what's in files at that moment instead of
   * whatever it was when the upload started. A file that's no longer
   * tracked (removeFile cancelled it) falls back to its last known state
   * with the same updates applied.
   */
  function currentItem(
    item: UploadItem,
    updates: Partial<UploadItem> = {},
  ): UploadItem {
    return (
      filesRef.current.find((f) => f.id === item.id) ?? { ...item, ...updates }
    );
  }

  /**
   * Fails an attempt before any request is made (beforeUpload or
   * onUploadRetry rejected it): marks the file as errored, fires
   * onUploadError and onUploadFinish, and resolves with the failure.
   */
  function rejectAttempt(
    item: UploadItem,
    error: Error,
  ): Promise<UploadResult<TUploadResponse>> {
    updateFile(item.id, { status: "error" });
    const errored = currentItem(item, { status: "error" });
    notify(optionsRef.current.onUploadError, { item: errored, error });
    notify(optionsRef.current.onUploadFinish, { item: errored });
    return Promise.resolve({ success: false as const, error });
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

    const { url, fileChunking } = optionsRef.current;

    return (
      uploadFile<TUploadResponse>({
        item,
        url,
        fileChunking,
        inFlight: inFlightRef.current,
        resumeState: resumeStateRef.current,
        onProgress,
      })
        // #24: settle the upload's outcome first, as its own step. Callbacks
        // run only after, so nothing they do can move a file between
        // "done" and "error" or change the result.
        .then(
          (data): UploadResult<TUploadResponse> => {
            updateFile(item.id, { status: "done", uploadProgress: 100 });
            return { success: true, data };
          },
          (error: Error): UploadResult<TUploadResponse> => {
            updateFile(item.id, { status: "error" });
            return { success: false, error };
          },
        )
        .then((result) => {
          const settled = currentItem(
            item,
            result.success
              ? { status: "done", uploadProgress: 100 }
              : { status: "error" },
          );
          const options = optionsRef.current;

          if (result.success) {
            notify(options.onUploadSuccess, { item: settled });
          } else {
            notify(options.onUploadError, {
              item: settled,
              error: result.error,
            });
          }
          notify(options.onUploadFinish, { item: settled });

          return result;
        })
    );
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
    const tracked = currentItem(item);

    /** Lifecycle hook for pre-upload validation/side effects */
    try {
      optionsRef.current.beforeUpload?.({ item: tracked });
    } catch (error) {
      return rejectAttempt(
        tracked,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return performUpload(tracked);
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

    const { beforeUpload, onUploadRetry, fileChunking } = optionsRef.current;

    /** Lifecycle hook for retrying an upload */
    try {
      onUploadRetry?.({ item: file });
      // #26: beforeUpload gates every attempt, not just the first — otherwise
      // a file it rejected (e.g. too large) could be uploaded just by
      // retrying it. Runs last so it's always the final check before a
      // request, same as in addFile.
      beforeUpload?.({ item: file });
    } catch (error) {
      return rejectAttempt(
        file,
        error instanceof Error ? error : new FileError(String(error)),
      );
    }

    updateFile(id, {
      status: "uploading",
      uploadProgress: getResumePercent(
        file,
        fileChunking,
        resumeStateRef.current,
      ),
    });
    return performUpload(currentItem(file));
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
    notify(optionsRef.current.onRemoveFile, { item: file });
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
