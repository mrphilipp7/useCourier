/**
 * #24: Surfaces an error thrown by a consumer's callback the way browsers
 * surface one thrown by an event listener — reported (so it shows in the
 * console and error-tracking tools pick it up) but without affecting the
 * code that called it. Falls back to console.error where reportError
 * doesn't exist (older browsers, some test environments).
 */
function reportCallbackError(error: unknown) {
  if (typeof globalThis.reportError === "function") {
    globalThis.reportError(error);
  } else {
    console.error(error);
  }
}

/**
 * Runs a notification callback (onUploadSuccess, onUploadError,
 * onUploadFinish, onRemoveFile). If it throws, the error is reported
 * instead of propagating, so a bug in consumer code can never change an
 * upload's status or the result addFile/retryUpload resolves with.
 *
 * Not for beforeUpload/onUploadRetry — throwing from those is how a
 * consumer rejects a file, so the hook needs to see it.
 */
export function notify<TContext>(
  callback: ((context: TContext) => void) | undefined,
  context: TContext,
) {
  if (!callback) return;

  try {
    callback(context);
  } catch (error) {
    reportCallbackError(error);
  }
}
