import { notify } from "./callbacks.js";
import { getResumePercent, type ChunkResumeState } from "./chunked-upload.js";
import { FileError } from "./errors.js";
import { createId } from "./ids.js";
import type { InFlightRequests } from "./transport.js";
import type { UploadItem, UploadResult, CourierOptions } from "./types.js";
import { uploadFile } from "./upload-file.js";

/**
 * #34: the framework-agnostic upload manager. It owns the file list and
 * everything that changes it (status transitions, the beforeUpload and
 * onUploadRetry gates, settle-then-notify callbacks, chunk resume) and
 * imports no framework. A framework adapter (the React hook) subscribes to
 * it and supplies the latest options through getOptions.
 */
export type Courier<TUploadResponse> = {
  /** The current file list. A new array after every change, so it can be compared by reference. */
  getFiles: () => UploadItem[];
  /** Calls listener after every change to the file list; returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
  addFile: (file: File) => Promise<UploadResult<TUploadResponse>>;
  retryUpload: (id: string) => Promise<UploadResult<TUploadResponse>>;
  removeFile: (id: string) => void;
  /**
   * Cancels every upload in progress — aborting in-flight requests and any
   * still waiting on async headers — for when the adapter goes away. The
   * courier stays usable: uploads started afterward run normally.
   */
  abortAll: () => void;
};

/**
 * Creates a courier. getOptions is called whenever an option or callback
 * is needed, so each read sees the adapter's latest options: an upload
 * outlives the render (or setup) it started in (#29).
 */
export function createCourier<TUploadResponse>(
  getOptions: () => CourierOptions<TUploadResponse>,
): Courier<TUploadResponse> {
  /**
   * The file list. Replaced (never mutated) on every change, and read
   * directly by every lookup, so a file is visible the moment addFile
   * returns — no waiting for a re-render (#21).
   */
  let files: UploadItem[] = [];
  const listeners = new Set<() => void>();
  const inFlight: InFlightRequests = new Map();
  const resumeState: ChunkResumeState = new Map();
  /**
   * Bumped by abortAll. An upload remembers the generation it started in,
   * so one still waiting on async headers (#20) — with no request yet to
   * abort — can tell it was cancelled once they resolve.
   */
  let generation = 0;

  /** The only way files changes: applies updater, then tells subscribers. */
  function commitFiles(updater: (prev: UploadItem[]) => UploadItem[]) {
    files = updater(files);
    listeners.forEach((listener) => listener());
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
    return files.find((f) => f.id === item.id) ?? { ...item, ...updates };
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
    const options = getOptions();
    notify(options.onUploadError, { item: errored, error });
    notify(options.onUploadFinish, { item: errored });
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

    const {
      url,
      fileChunking,
      method,
      headers,
      withCredentials,
      fieldName,
      formFields,
    } = getOptions();
    const startedIn = generation;

    return (
      uploadFile<TUploadResponse>({
        item,
        url,
        fileChunking,
        request: { method, headers, withCredentials, fieldName, formFields },
        inFlight,
        resumeState,
        // #20: there's nothing to abort while async headers are pending, so
        // the upload checks this once they resolve.
        isCancelled: () =>
          generation !== startedIn || !files.some((f) => f.id === item.id),
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
          (error: unknown): UploadResult<TUploadResponse> => {
            updateFile(item.id, { status: "error" });
            // A consumer's headers/formFields function can throw anything.
            return {
              success: false,
              error: error instanceof Error ? error : new Error(String(error)),
            };
          },
        )
        .then((result) => {
          const settled = currentItem(
            item,
            result.success
              ? { status: "done", uploadProgress: 100 }
              : { status: "error" },
          );
          const options = getOptions();

          if (result.success) {
            notify(options.onUploadSuccess, {
              item: settled,
              data: result.data,
            });
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

  /** Adds a file, runs beforeUpload, and starts its upload. A beforeUpload rejection only fails this one file — safe to call in a loop over multiple files. */
  function addFile(file: File): Promise<UploadResult<TUploadResponse>> {
    if (!(file instanceof File)) {
      return Promise.resolve({
        success: false as const,
        error: new FileError("Invalid file provided"),
      });
    }

    const tracked: UploadItem = {
      id: createId(),
      file,
      status: "uploading",
      uploadProgress: 0,
    };
    commitFiles((prev) => [...prev, tracked]);

    /** Lifecycle hook for pre-upload validation/side effects */
    try {
      getOptions().beforeUpload?.({ item: tracked });
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

    const { beforeUpload, onUploadRetry, fileChunking } = getOptions();

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
      uploadProgress: getResumePercent(file, fileChunking, resumeState),
    });
    return performUpload(currentItem(file));
  }

  /** Drops a file from tracked state by id, aborting its upload if one is in flight. */
  function removeFile(id: string) {
    const file = files.find((f) => f.id === id);
    if (!file) return;

    inFlight.get(id)?.abort();
    // #6: no point resuming a chunked upload for a file that's no longer tracked.
    resumeState.delete(id);
    commitFiles((prev) => prev.filter((f) => f.id !== id));
    /** Lifecycle hook for when a file is removed from the upload */
    notify(getOptions().onRemoveFile, { item: file });
  }

  function abortAll() {
    generation += 1;
    inFlight.forEach((xhr) => xhr.abort());
  }

  return {
    getFiles: () => files,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    addFile,
    retryUpload,
    removeFile,
    abortAll,
  };
}
